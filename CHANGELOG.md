# Changelog

All notable changes to **VRV: VideoReViewer** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.2.0] - 2026-09-04

### Added
- **Official Rebranding (VRV: VideoReViewer)**:
  - Formal name: `VideoReViewer`
  - Abbreviation: `VRV` (Reading: ブイレブ)
  - Display notation: `VRV: VideoReViewer`
  - Official tagline: `Review what you view.`
  - Official vector logo: Hybrid Film strip + Play button + Checkmark SVG icon.
- **Internationalization & Localization (i18n)**:
  - Proprietary lightweight (~7KB) custom i18n engine without external dependencies.
  - Full support for 3 languages: Japanese (`ja`, canonical), English (`en`), and Simplified Chinese (`zh-CN`).
  - Strict 100% key parity across all 3 languages (377 keys total).
  - Dynamic UI translation for toasts, confirmations, modals, radar charts, and badge labels.
  - Synchronized `<html lang>` attribute and dynamic `<title>` localization.
- **Settings Language Selector & Recovery UX**:
  - Top-level Language Selector in Settings Modal with persistent UI locale preference stored in LocalStorage (`video_reviewer_locale`).
  - Fallback and recovery visual path (Gear icon -> Globe icon -> "Language" label -> native language names: `日本語`, `English`, `简体中文`) ensuring users can easily navigate back from unfamiliar languages.
- **Untouched Built-in Seed Display Translation**:
  - Dynamic display translation for default genres (e.g. `一般` / `General` / `常规`) and default criteria (`内容`, `映像`, `音声`, `テンポ`, `独自性`, `再視聴性` etc.).
  - Domain isolation: Built-in seeds, reviews, and user domain data remain strictly canonical and locale-independent in the database (IndexedDB); translated built-in labels are never persisted to the database.
  - Backup and sharing boundary: Neither UI locale preferences (`video_reviewer_locale`) nor translated labels are included in database backup ZIPs or Shared Review packages.
  - Strict user-edit protection (`resolveUserEditedValue`): User-customized titles and modifications are rigorously preserved as canonical data and never overwritten by UI translations.
- **Fail-Closed Translation Leak Detection & Self-Testing**:
  - Automated HTML and JS API leak detector inspecting static DOM text nodes and UI invocation literals.
  - Fail-closed regression test suite (Tests 22–31) with detector self-testing.
- **Expanded Test Suite**:
  - Total automated test count expanded from 389 to **442 tests** (100% pass rate).
  - Added test runner support for `--lang=` browser locale simulation.

---

## [v1.1.0] - 2026-08-31

### Added
- **Automatic Custom Poster Detection**:
  - Automatic association of image files (`.jpg`, `.jpeg`, `.png`, `.webp`) sharing the same file basename as video assets during directory scans.
  - Deterministic candidate selection priority: `.jpg` ➔ `.jpeg` ➔ `.png` ➔ `.webp`.
  - Case-insensitive basename matching (e.g., `Sample.mp4` matches `sample.jpg` or `SAMPLE.PNG`).
  - Safe non-destructive error handling for corrupted images or files exceeding the 10MB limit.
  - Protection against overwriting user-configured custom posters.
  - Full backup inclusion (`images/posters/`) with exclusion from Shared Review packages to maintain privacy and lightweight payloads.

---

## [v1.0.0] - 2026-08-31

### Added
- **First Stable Release of VideoReviewer**:
  - Local-first architecture using File System Access API (`DirectoryHandle` / `FileHandle`).
  - SHA-256 video content hashing with two-stage verification (`provisional` quick hash ➔ `completed` background full hash).
  - Database Schema v4 supporting multiple reviewers per media asset.
  - Shared Review Package v1 specification for importing/exporting peer reviews with atomic rollback protection.
  - Read-only protection for imported reviews.
  - Multi-reviewer aggregation UI: live arithmetic average scoring, merged tags with attribution tooltips, and deterministic timeline comment merging.
  - Pending shared review staging with atomic linking upon content hash resolution.
  - Tag master management with cascade unlinking.
  - Complete database ZIP backup and restore with automatic schema migration and rollback safety.
  - GitHub Actions automated CI testing via Chrome Headless.
