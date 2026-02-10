# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] - 2026-02-10

### Fixed
- Build script paths in GitHub Actions workflow and PyInstaller shell/PowerShell scripts
- Spec file path resolution for cross-platform builds


## [1.5.0] - 2026-02-10

### Changed
- Major project reorganization: moved core logic to `lectern/`, assets to `resources/`, and configurations to `specs/`
- Standardized internal imports across the entire codebase
- Cleaned up build scripts and PyInstaller specification files for absolute path reliability


## [1.4.0] - 2026-02-10

### Added
- Introduce card count targeting and streaming logic for generation
- Centralize PDF processing and generation logic
- Add release workflow documentation

### Changed
- Remove unused PhaseAnimation and SkeletonCard components, update ProgressView for cleaner state handling
- Update frontend store types and refresh test assets
- Refactor and enhance various components and services

## [1.3.0] - 2026-02-10

### Added
- Enhance AI client with thinking profiles and improve tag context management
- Enhance concept schema and improve history management in AI client

### Fixed
- Remove density clamping in frontend and extend card generation cap during reflection phase

### Changed
- Overhaul content processing with a new generation loop and cost estimation
- Remove obsolete audit documentation and finalize pending refactors
- Check if ci / cd pipeline works since last release
- Run all tests (and fix bugs)
