# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Inisialisasi struktur backend Firebase MODULA dengan TypeScript dan Cloud Functions v2.
- Modul autentikasi operator berbasis Firestore dan Firebase Auth custom claims.
- Modul Activity CRUD dengan validasi unique slug dan scheduling server-side.
- Modul Builder/Question dengan batasan prompt 255 karakter, bobot kustom, dan pilihan ganda.
- Endpoint publik peserta `/{slug}` dengan sanitasi tanpa kebocoran kunci jawaban.
- Modul Attempt dan pencatatan jawaban dengan pelacakan durasi per-pertanyaan.
- Pure scoring engine dengan kalkulasi bobot kebenaran, speed bonus, dan final score.
- Realtime leaderboard dengan data top 5 dan snapshot Firestore.
- Modul Stats untuk analitik skor, timing, database peserta/respons, dan perbandingan pre/post.
- Kebijakan upload media gambar soal dan Firestore/Storage security rules.
- Spesifikasi OpenAPI 3.1 dan Swagger UI di `/api/docs` serta `/api/openapi.json`.
- Script bootstrap owner pertama di `scripts/bootstrap-owner.ts`.
- Automated test suite lengkap dengan Vitest dan Firebase Emulator Suite (31 tes lolos).

### Changed
- Konfigurasi Firestore dengan `ignoreUndefinedProperties` untuk integritas data dokumen.

### Fixed
- Penanganan penautan dan pembuatan otomatis user Firebase Auth pada alur login operator dan bootstrap script.
