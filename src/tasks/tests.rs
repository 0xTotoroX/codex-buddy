// [INPUT]: Synthetic local tasks and complete remote snapshots.
// [OUTPUT]: Regression checks for field merging, identity and durable edits.
// [POS]: Task-domain tests; never access EventKit or user reminders.
// [PROTOCOL]: Update tasks/AGENTS.md when adding behavioral contracts.
use super::*;
fn fields(title: &str) -> Fields {
    Fields {
        title: title.into(),
        ..Fields::default()
    }
}
fn remote(id: &str, title: &str) -> Remote {
    Remote {
        id: id.into(),
        external_id: Some(format!("ext-{id}")),
        marker: None,
        fields: fields(title),
        recurring: false,
    }
}
#[test]
fn merges_independent_fields_and_retains_same_field_conflicts() {
    let base = fields("one");
    let mut local = base.clone();
    local.notes = "local notes".into();
    let mut apple = base.clone();
    apple.completed = true;
    let (merged, conflicts) = merge(&base, &local, &apple);
    assert!(conflicts.is_empty());
    assert!(merged.completed);
    assert_eq!(merged.notes, "local notes");
    local.title = "local".into();
    apple.title = "apple".into();
    let (merged, conflicts) = merge(&base, &local, &apple);
    assert_eq!(merged.title, "local");
    assert_eq!(conflicts, vec!["title"]);
}
#[test]
fn missing_remote_preserves_recovery_and_unique_external_id_rebinds() {
    let mut store = Store::default();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![remote("one", "same")],
            ..Default::default()
        },
    );
    reconcile(&mut store, &Snapshot::default());
    assert!(store.tasks[0].remote_missing);
    assert_eq!(store.tasks[0].fields.title, "same");
    let mut changed = remote("one", "changed");
    changed.id = "new".into();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![changed],
            ..Default::default()
        },
    );
    assert_eq!(store.tasks.len(), 1);
    assert!(!store.tasks[0].remote_missing);
    assert_eq!(store.tasks[0].fields.title, "changed");
    assert_eq!(store.tasks[0].remote.as_ref().unwrap().id, "new");
}
#[test]
fn never_matches_same_titles_or_ambiguous_external_identity() {
    let mut store = Store::default();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![remote("one", "same"), remote("two", "same")],
            ..Default::default()
        },
    );
    assert_eq!(store.tasks.len(), 2);
    let mut duplicate = remote("other", "same");
    duplicate.external_id = Some("ext-one".into());
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![remote("one", "same"), duplicate],
            ..Default::default()
        },
    );
    assert!(store.tasks[0].remote_missing);
}
#[test]
fn delete_and_remote_edit_is_a_conflict() {
    let mut store = Store::default();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![remote("one", "old")],
            ..Default::default()
        },
    );
    store.tasks[0].delete_requested = true;
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![remote("one", "new")],
            ..Default::default()
        },
    );
    assert!(
        store.tasks[0]
            .conflict
            .as_ref()
            .unwrap()
            .fields
            .contains(&"delete".into())
    );
}
#[tokio::test]
async fn durable_edit_revision_and_module_independence() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().to_path_buf())).unwrap();
    let service = Service::load(&paths);
    service
        .command(json!({"op":"modules","revision":1,"boardEnabled":true}))
        .await
        .unwrap();
    service
        .command(json!({"op":"create","revision":2,"fields":fields("task")}))
        .await
        .unwrap();
    assert!(
        service
            .command(json!({"op":"create","revision":2,"fields":fields("stale")}))
            .await
            .is_err()
    );
    let restored = Service::load(&paths);
    let state = restored.state().await;
    assert_eq!(state["store"]["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(state["store"]["syncEnabled"], false);
    restored
        .command(json!({"op":"modules","revision":3,"boardEnabled":false}))
        .await
        .unwrap();
    assert_eq!(
        restored.state().await["store"]["tasks"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[tokio::test]
async fn corrupted_store_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().to_path_buf())).unwrap();
    std::fs::write(paths.root.join("tasks.json"), b"broken").unwrap();
    let service = Service::load(&paths);
    assert!(
        service
            .command(json!({"op":"modules","revision":1,"boardEnabled":true}))
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read(paths.root.join("tasks.json")).unwrap(),
        b"broken"
    );
}
#[test]
fn dates_keep_all_day_semantics_and_validate_leap_years() {
    let mut f = fields("task");
    f.due = Some(Due {
        year: 2026,
        month: 2,
        day: 29,
        ..Default::default()
    });
    assert!(f.validate().is_err());
    f.due.as_mut().unwrap().year = 2028;
    assert!(f.validate().is_ok());
    assert_eq!(f.due.unwrap().hour, None);
}

#[test]
fn repeated_remote_changes_do_not_create_false_conflicts() {
    let mut store = Store::default();
    let base = remote("one", "old");
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![base.clone()],
            ..Default::default()
        },
    );
    store.tasks[0].fields.title = "local".into();
    let mut changed = base;
    changed.fields.title = "remote".into();
    changed.fields.notes = "first note".into();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![changed.clone()],
            ..Default::default()
        },
    );
    changed.fields.notes = "second note".into();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![changed],
            ..Default::default()
        },
    );
    assert_eq!(store.tasks[0].fields.notes, "second note");
    assert_eq!(
        store.tasks[0].conflict.as_ref().unwrap().fields,
        vec!["title"]
    );
}
#[test]
fn uncertain_create_preserves_remote_edits_and_does_not_import_twice() {
    let mut store = Store::default();
    let desired = fields("created title");
    store.tasks.push(Task {
        id: "local-one".into(),
        fields: desired.clone(),
        archived: false,
        delete_requested: false,
        remote: None,
        remote_missing: false,
        conflict: None,
    });
    store.inflight = Some(Intent {
        task_id: "local-one".into(),
        action: "create".into(),
        expected: None,
        desired,
    });
    let mut changed = remote("apple-one", "edited on phone");
    changed.marker = Some("codexbuddy://task/local-one".into());
    let snapshot = Snapshot {
        reminders: vec![changed],
        ..Default::default()
    };
    recover_inflight(&mut store, &snapshot);
    reconcile(&mut store, &snapshot);
    assert_eq!(store.tasks.len(), 1);
    assert_eq!(store.tasks[0].fields.title, "edited on phone");
    assert!(store.inflight.is_none());
}
#[test]
fn uncertain_create_absence_is_not_retried() {
    let mut store = Store {
        inflight: Some(Intent {
            task_id: "one".into(),
            action: "create".into(),
            expected: None,
            desired: fields("pending"),
        }),
        ..Default::default()
    };
    recover_inflight(&mut store, &Snapshot::default());
    assert!(store.inflight.is_some());
}
#[tokio::test]
async fn stale_disable_does_not_leave_worker_silently_paused() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    let service = Service::load(&paths);
    service.inner.lock().await.store.sync_enabled = true;
    service.desired.store(true, Ordering::SeqCst);
    assert!(
        service
            .command(json!({"op":"modules","revision":0,"syncEnabled":false}))
            .await
            .is_err()
    );
    assert!(service.desired.load(Ordering::SeqCst));
    assert!(service.inner.lock().await.store.sync_enabled);
}
#[tokio::test]
async fn resolving_remote_conflict_preserves_uncontested_local_edits() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    let service = Service::load(&paths);
    let id = {
        let mut inner = service.inner.lock().await;
        inner.store.board_enabled = true;
        reconcile(
            &mut inner.store,
            &Snapshot {
                reminders: vec![remote("one", "base")],
                ..Default::default()
            },
        );
        inner.store.tasks[0].fields.title = "local".into();
        inner.store.tasks[0].fields.notes = "keep me".into();
        reconcile(
            &mut inner.store,
            &Snapshot {
                reminders: vec![remote("one", "apple")],
                ..Default::default()
            },
        );
        inner.store.tasks[0].id.clone()
    };
    service
        .command(json!({"op":"resolve","revision":1,"id":id,"choice":"remote"}))
        .await
        .unwrap();
    let inner = service.inner.lock().await;
    assert_eq!(inner.store.tasks[0].fields.title, "apple");
    assert_eq!(inner.store.tasks[0].fields.notes, "keep me");
}

#[test]
fn repairing_missing_lists_preserves_valid_bindings_and_recovery_records() {
    let bindings = Bindings {
        calendar_id: "deleted".into(),
        ..Default::default()
    };
    let calendars: Vec<Calendar> = ["new", "doing", "waiting", "other"]
        .into_iter()
        .map(|id| Calendar {
            id: id.into(),
            title: id.into(),
            source: "account".into(),
            source_title: "iCloud".into(),
            writable: true,
        })
        .collect();
    let replacement = Bindings {
        calendar_id: "new".into(),
        ..bindings.clone()
    };
    assert!(bindings.validate_repair(&replacement, &calendars).is_ok());
    assert!(
        replacement
            .validate_repair(
                &Bindings {
                    calendar_id: "other".into(),
                    ..replacement.clone()
                },
                &calendars
            )
            .is_err()
    );
    assert!(
        replacement
            .validate_repair(&replacement, &calendars)
            .is_err()
    );
    let mut store = Store::default();
    let mut surviving = remote("surviving", "retained");
    surviving.fields.column = "waiting".into();
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![remote("missing", "recover me"), surviving.clone()],
            ..Default::default()
        },
    );
    store.bindings = replacement;
    reconcile(
        &mut store,
        &Snapshot {
            reminders: vec![surviving],
            calendars,
        },
    );
    assert_eq!(store.tasks.len(), 2);
    assert!(store.tasks[0].remote_missing);
    assert!(store.tasks[0].remote.is_some());
    assert_eq!(store.tasks[0].fields.title, "recover me");
    assert!(!store.tasks[1].remote_missing);
}

#[tokio::test]
async fn resizing_keeps_edit_revision_and_stale_task_baselines_cannot_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    let service = Service::load(&paths);
    service
        .command(json!({"op":"modules","revision":1,"boardEnabled":true}))
        .await
        .unwrap();
    service
        .command(json!({"op":"create","revision":2,"fields":fields("original")}))
        .await
        .unwrap();
    let task = service.state().await["store"]["tasks"][0].clone();
    service
        .command(json!({"op":"windowSize","size":[900,600]}))
        .await
        .unwrap();
    assert_eq!(service.state().await["store"]["revision"], 3);
    service.command(json!({"op":"update","revision":3,"id":task["id"],"expectedTask":task,"fields":fields("latest")})).await.unwrap();
    assert!(service.command(json!({"op":"update","revision":4,"id":task["id"],"expectedTask":task,"fields":fields("stale draft")})).await.is_err());
    assert_eq!(
        service.state().await["store"]["tasks"][0]["fields"]["title"],
        "latest"
    );
    assert_eq!(
        Service::load(&paths).state().await["store"]["windowSize"],
        json!([900, 600])
    );
}

#[tokio::test]
async fn embedded_view_cannot_authorize_or_change_sync_configuration() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    let service = Service::load(&paths);
    for op in [
        "authorize",
        "calendars",
        "createLists",
        "modules",
        "bindings",
        "repairBindings",
        "open",
        "windowSize",
    ] {
        assert!(
            service
                .view_command(json!({"op":op,"revision":1,"syncEnabled":true}))
                .await
                .is_err(),
            "{op}"
        );
    }
    assert!(!service.board_enabled().await);
    assert_eq!(service.state().await["store"]["syncEnabled"], false);
}

#[test]
fn stages_archive_and_legacy_metadata_never_produce_remote_writes() {
    let mut store = Store::default();
    let snapshot = Snapshot {
        reminders: vec![remote("one", "task")],
        ..Default::default()
    };
    reconcile(&mut store, &snapshot);
    let task = &mut store.tasks[0];
    task.fields.column = "doing".into();
    task.fields.priority = 1;
    task.archived = true;
    assert!(task.sync_intent().is_none());
    let mut changed = snapshot.clone();
    changed.reminders[0].fields.priority = 9;
    changed.reminders[0].fields.column = "todo".into();
    changed.reminders[0].fields.completed = true;
    for _ in 0..3 {
        reconcile(&mut store, &changed);
    }
    let task = &mut store.tasks[0];
    assert_eq!(task.fields.column, "doing");
    assert_eq!(task.fields.priority, 1);
    assert!(task.archived && task.fields.completed && task.conflict.is_none());
    assert!(task.sync_intent().is_none());
    task.fields.notes = "local edit".into();
    assert_eq!(task.sync_intent().unwrap().action, "update");
    task.fields.accept_synced(&changed.reminders[0].fields);
    assert_eq!(task.fields.column, "doing");
    assert_eq!(task.fields.priority, 1);
}

#[tokio::test]
async fn legacy_migration_pauses_sync_preserves_identity_and_never_replays_delete() {
    for action in ["create", "update", "delete"] {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let mut old = Store {
            schema: 1,
            sync_enabled: true,
            board_enabled: true,
            ..Default::default()
        };
        reconcile(
            &mut old,
            &Snapshot {
                reminders: vec![remote("old", "keep")],
                ..Default::default()
            },
        );
        old.tasks[0].fields.column = "waiting".into();
        old.tasks[0].delete_requested = action == "delete";
        old.bindings.todo = "original-todo".into();
        old.inflight = Some(Intent {
            task_id: old.tasks[0].id.clone(),
            action: action.into(),
            expected: old.tasks[0].remote.clone(),
            desired: old.tasks[0].fields.clone(),
        });
        let bytes = serde_json::to_vec(&old).unwrap();
        std::fs::write(paths.root.join("tasks.json"), &bytes).unwrap();
        let service = Service::load(&paths);
        let inner = service.inner.lock().await;
        assert_eq!(inner.store.schema, 2);
        assert!(!inner.store.sync_enabled && !service.desired.load(Ordering::SeqCst));
        assert_eq!(inner.store.tasks[0].id, old.tasks[0].id);
        assert_eq!(inner.store.tasks[0].remote, old.tasks[0].remote);
        assert_eq!(inner.store.tasks[0].fields.column, "waiting");
        assert!(!inner.store.tasks[0].delete_requested);
        assert_eq!(inner.store.inflight.is_some(), action != "delete");
        assert_eq!(inner.store.tasks[0].archived, action == "delete");
        assert!(inner.store.bindings.calendar_id.is_empty());
        assert_eq!(inner.store.bindings.todo, "original-todo");
        assert_eq!(
            std::fs::read(paths.root.join("tasks-v1.json")).unwrap(),
            bytes
        );
    }
}

#[test]
fn uncertain_update_checks_only_shared_fields_and_preserves_local_stage() {
    let mut store = Store::default();
    let snapshot = Snapshot {
        reminders: vec![remote("one", "task")],
        ..Default::default()
    };
    reconcile(&mut store, &snapshot);
    store.tasks[0].fields.column = "doing".into();
    store.tasks[0].fields.notes = "sent".into();
    store.inflight = store.tasks[0].sync_intent();
    let mut received = snapshot;
    received.reminders[0].fields.notes = "sent".into();
    received.reminders[0].fields.priority = 9;
    recover_inflight(&mut store, &received);
    reconcile(&mut store, &received);
    assert!(store.inflight.is_none());
    assert_eq!(store.tasks[0].fields.column, "doing");
    assert_eq!(store.tasks[0].fields.priority, 0);
    assert!(store.tasks[0].sync_intent().is_none());
}

#[tokio::test]
async fn archive_keeps_remote_identity_and_delete_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    let service = Service::load(&paths);
    let id = {
        let mut inner = service.inner.lock().await;
        inner.store.board_enabled = true;
        reconcile(
            &mut inner.store,
            &Snapshot {
                reminders: vec![remote("one", "task")],
                ..Default::default()
            },
        );
        inner.store.tasks[0].id.clone()
    };
    service
        .command(json!({"op":"archive","revision":1,"id":id,"archived":true}))
        .await
        .unwrap();
    assert!(
        service
            .command(json!({"op":"delete","revision":2,"id":id,"confirmBoth":true}))
            .await
            .is_err()
    );
    let inner = service.inner.lock().await;
    assert_eq!(inner.store.tasks.len(), 1);
    assert!(inner.store.tasks[0].archived && !inner.store.tasks[0].fields.completed);
    assert!(inner.store.tasks[0].remote.is_some());
    assert!(inner.store.tasks[0].sync_intent().is_none());
}

#[tokio::test]
async fn local_removal_persists_without_reimporting_or_writing_remote() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    let service = Service::load(&paths);
    let mut original = remote("one", "remote task");
    original.marker = Some("codexbuddy://task/old".into());
    let snapshot = Snapshot {
        reminders: vec![original.clone()],
        ..Default::default()
    };
    let task = {
        let mut inner = service.inner.lock().await;
        inner.store.board_enabled = true;
        reconcile(&mut inner.store, &snapshot);
        // A local change awaiting sync must not be written after removal.
        inner.store.tasks[0].fields.notes = "local change".into();
        inner.store.tasks[0].clone()
    };
    assert!(
        service
            .view_command(json!({"op":"remove","revision":0,"id":task.id}))
            .await
            .is_err()
    );
    assert!(
        service
            .view_command(json!({"op":"remove","revision":1,"id":task.id,"expectedTask":null}))
            .await
            .is_err()
    );
    {
        let mut inner = service.inner.lock().await;
        inner.store.inflight = task.sync_intent();
    }
    assert!(
        service
            .view_command(json!({"op":"remove","revision":1,"id":task.id}))
            .await
            .is_err()
    );
    service.inner.lock().await.store.inflight = None;
    service
        .view_command(json!({"op":"remove","revision":1,"id":task.id,"expectedTask":task}))
        .await
        .unwrap();
    let reloaded = Service::load(&paths);
    let mut inner = reloaded.inner.lock().await;
    assert!(inner.store.tasks.is_empty());
    assert!(inner.store.inflight.is_none());
    assert_eq!(inner.store.deleted_reminders.len(), 1);
    reconcile(&mut inner.store, &snapshot);
    let mut changed_id = original.clone();
    changed_id.id = "new-id".into();
    changed_id.fields.title = "Apple edit".into();
    changed_id.marker = None;
    reconcile(
        &mut inner.store,
        &Snapshot {
            reminders: vec![changed_id],
            ..Default::default()
        },
    );
    let mut marker_only = original.clone();
    marker_only.id = "another-id".into();
    marker_only.external_id = None;
    reconcile(
        &mut inner.store,
        &Snapshot {
            reminders: vec![marker_only],
            ..Default::default()
        },
    );
    assert!(inner.store.tasks.is_empty());
    reconcile(
        &mut inner.store,
        &Snapshot {
            reminders: vec![original.clone(), remote("other", "remote task")],
            ..Default::default()
        },
    );
    assert_eq!(
        inner.store.tasks.len(),
        1,
        "a separate same-title reminder still imports"
    );
    assert_eq!(snapshot.reminders[0], original);
}
