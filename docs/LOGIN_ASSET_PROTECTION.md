# Login Branding Asset Protection

The login logo and gallery are protected as release-critical branding assets. They must not be removed, replaced, resized, or silently altered during cleanup, refactoring, dependency updates, or feature development.

## Protected files

The authoritative list is stored in `config/login-assets.integrity.json`. The manifest currently protects the login logo at `public/assets/osaah-daylight-school-complex-logo.png` and all eleven images under `public/assets/login-gallery/`.

For every protected file, the manifest records its SHA-256 digest, byte count, and image dimensions. The verifier also confirms that each manifest entry still exists, remains under `public/assets/`, and is referenced by `public/index.html`.

## Enforcement

Run the following command locally before committing changes:

```bash
npm run assets:verify
```

The GitHub Actions workflow `.github/workflows/login-assets-integrity.yml` runs the same check on pull requests and on pushes to `main` and `master`. A deleted or altered file fails the check. A missing login-page reference also fails the check. `.github/CODEOWNERS` requires explicit review from `@FRANK12517` for the login page, protected assets, manifest, verifier, and workflow.

These controls are intentionally complementary. The manifest detects content changes, the verifier detects missing references and missing files, the CI workflow blocks the integrity check from passing, and CODEOWNERS makes intentional changes visible to the designated repository owner. Repository branch protection should require the `Verify protected login assets` status check before merging into `main`.

## Intentional asset replacement

An intentional replacement must be handled in one reviewed pull request. Replace the file, regenerate the manifest with a reviewed one-time generation process, run `npm run assets:verify`, run the full test suite, and explain the visual and functional reason for the change in the pull request. Do not weaken the verifier, remove the workflow, or delete the manifest to make a change pass.
