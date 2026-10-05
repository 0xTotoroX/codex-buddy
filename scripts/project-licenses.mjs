/*
 * [INPUT]: Project GPLv3 text, preserved MIT history and licensing scope.
 * [OUTPUT]: Exact-text validation and a shared license bundle for program/material archives.
 * [POS]: License-only packaging helper; never rewrites third-party notices.
 * [PROTOCOL]: Update this contract and scripts/AGENTS.md when changing the bundle.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PROJECT_LICENSE = 'GPL-3.0-only';
// Unmodified SPDX license-list-data GPL-3.0-only text; see LICENSING.md.
export const GPL3_SHA256 = 'fb981668c18a279e285fc4d83fba1e836cc84dd4daa73c9697d3cfd2d8aca6e0';
export const LEGACY_MIT_SHA256 = 'a1091dee36dfd67ce14b0ecc525baa956d8d53bb93bc1a8f8989ac0c3b0b2802';
export const PROJECT_LICENSE_FILES = ['LICENSE', 'LICENSING.md', 'licenses/LICENSE-MIT-legacy'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyProjectLicenses(root) {
  assert.equal(digest(readFileSync(join(root, 'LICENSE'))), GPL3_SHA256, 'GPLv3 text changed');
  assert.equal(
    digest(readFileSync(join(root, 'licenses/LICENSE-MIT-legacy'))),
    LEGACY_MIT_SHA256,
    'Historical MIT notice changed',
  );
  const scope = readFileSync(join(root, 'LICENSING.md'), 'utf8');
  assert.ok(scope.includes(PROJECT_LICENSE), 'Missing GPL-3.0-only scope');
  assert.ok(scope.includes('Copyright (c) 2026 0xTotoroX'), 'Missing project copyright');
}

export function copyProjectLicenses(root, destination) {
  verifyProjectLicenses(root);
  for (const file of PROJECT_LICENSE_FILES) {
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    copyFileSync(join(root, file), join(destination, file));
  }
}
