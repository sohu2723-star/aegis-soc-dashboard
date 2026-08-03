# AEGIS Project Book Download

GitHub cannot display Microsoft Word binary changes in a pull-request diff. The
finished Word document is therefore stored as Base64 **text**, which GitHub can
accept normally.

From the repository root, reconstruct the downloadable Word file with:

```bash
./scripts/build_project_book_file.sh
```

This creates `AEGIS_SOC_Dashboard_Project_Book.docx` and verifies its SHA-256
checksum automatically. To choose another output location, pass it as the first
argument:

```bash
./scripts/build_project_book_file.sh ~/Downloads/AEGIS_Project_Book.docx
```

No Python or Microsoft Word installation is needed to reconstruct the file.
