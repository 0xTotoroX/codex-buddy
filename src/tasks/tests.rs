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
        todo: "deleted".into(),
        doing: "doing".into(),
        waiting: "waiting".into(),
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
        todo: "new".into(),
        ..bindings.clone()
    };
    assert!(bindings.validate_repair(&replacement, &calendars).is_ok());
    assert!(
        bindings
            .validate_repair(
                &Bindings {
                    doing: "other".into(),
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
