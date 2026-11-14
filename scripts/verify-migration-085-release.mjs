import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function requireFullSha(value, label) {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a full lowercase 40-character commit SHA.`);
  }
  return value;
}

export function assertMigration085Release({ releaseRef, checkedOutSha, protectedMainSha, isAncestor }) {
  const expectedSha = requireFullSha(releaseRef, 'release_ref');
  const checkedOut = requireFullSha(checkedOutSha, 'checked-out commit');
  const mainSha = requireFullSha(protectedMainSha, 'protected main commit');
  if (checkedOut !== expectedSha) {
    throw new Error(`Checked-out commit ${checkedOut} does not match reviewed release ${expectedSha}.`);
  }
  if (typeof isAncestor !== 'boolean') throw new Error('Protected-main ancestry could not be verified.');
  if (!isAncestor) throw new Error(`Reviewed release ${expectedSha} is not reachable from protected main ${mainSha}.`);
  return { releaseSha: expectedSha, protectedMainSha: mainSha };
}

export function protectedMainFetchArgs(isShallow) {
  return [
    'fetch',
    '--no-tags',
    ...(isShallow ? ['--unshallow'] : []),
    'origin',
    '+refs/heads/main:refs/remotes/origin/main'
  ];
}

function gitOutput(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fetchProtectedMain(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error('Unable to fetch protected main history for release verification.');
}

function repositorySlug(remoteUrl) {
  const match = String(remoteUrl).trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function verifyMigration085Release({ releaseRef, repository = process.env.GITHUB_REPOSITORY } = {}) {
  const expectedSha = requireFullSha(releaseRef, 'release_ref');
  if (repository) {
    const origin = gitOutput(['remote', 'get-url', 'origin']);
    if (repositorySlug(origin) !== String(repository).toLowerCase()) {
      throw new Error('The origin remote does not match the GitHub repository running this workflow.');
    }
  }

  const resolvedReleaseSha = gitOutput(['rev-parse', '--verify', `${expectedSha}^{commit}`]);
  const checkedOutSha = gitOutput(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (checkedOutSha !== resolvedReleaseSha || resolvedReleaseSha !== expectedSha) {
    throw new Error(`Checked-out commit ${checkedOutSha} does not match reviewed release ${expectedSha}.`);
  }

  const isShallow = gitOutput(['rev-parse', '--is-shallow-repository']) === 'true';
  fetchProtectedMain(protectedMainFetchArgs(isShallow));
  const protectedMainSha = gitOutput(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', resolvedReleaseSha, protectedMainSha], { stdio: 'ignore' });
  if (ancestry.error || ![0, 1].includes(ancestry.status)) throw new Error('Protected-main ancestry could not be verified.');
  return assertMigration085Release({
    releaseRef: expectedSha,
    checkedOutSha,
    protectedMainSha,
    isAncestor: ancestry.status === 0
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = verifyMigration085Release({ releaseRef: process.env.RELEASE_REF });
    process.stdout.write(`Verified reviewed release ${result.releaseSha} is checked out and is an ancestor of protected main ${result.protectedMainSha}.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
