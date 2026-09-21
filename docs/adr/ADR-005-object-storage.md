# ADR-005 — S3-compatible object storage for documents

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

Users upload invoices, receipts, MOT certificates, insurance documents and photos. These
are private by default and frequently contain personal data: names, addresses, registration
numbers, sometimes bank details on an invoice.

Volume is modest per user but unbounded in aggregate, and files are large relative to the
relational data around them.

## Decision

**S3-compatible object storage**, with PostgreSQL holding metadata only. MinIO provides the
same API locally, so there is no cloud dependency for development.

- Private buckets. No public read, no public list, no website hosting.
- Uploads go **directly from browser to storage** via a presigned PUT; the file never
  passes through the API.
- The API issues the upload session after validating declared type, extension and size
  against plan limits, and creates a `PENDING` document row.
- Finalisation verifies existence, size and SHA-256 checksum before promoting to
  `AVAILABLE`. Unconfirmed rows and orphaned objects are reaped nightly.
- Downloads are 5-minute signed URLs issued only after a permission check.
- Keys are `workspaces/{workspaceId}/{yyyy}/{mm}/{uuidv7}{ext}` — tenant-namespaced and
  unguessable.

## Alternatives considered

**Files in PostgreSQL (`bytea` or large objects).** Transactional consistency between
metadata and content, and one backup covers everything. Rejected decisively: it bloats the
database, makes backup and restore times grow with document volume rather than data volume,
wastes the buffer cache on blobs, and streams every download through the API. A 20 MB PDF
has no business in a relational database.

**Local filesystem on the API host.** Simple, but breaks with more than one replica,
couples storage durability to a compute instance, and makes horizontal scaling impossible.

**A vendor-specific service (e.g. a proprietary blob API).** No meaningful advantage over
the S3 API, which every serious provider implements and which MinIO reproduces locally.

**Uploads proxied through the API.** Simpler permission logic, but every large upload
occupies a Node process for its duration, and request body limits become a product
constraint. Presigned uploads move that cost to the storage provider.

## Consequences

**Positive.** Database stays small and fast to back up. Uploads and downloads do not consume
API capacity. Provider-independent. Local development needs no cloud account.

**Negative.** Two systems must be kept consistent — hence `PENDING`/`AVAILABLE` states,
checksum verification and nightly reaping. Deletion is two-phase (row soft-deleted
immediately, object purged after retention). Signed URLs are bearer credentials for their
lifetime, so they are short-lived and never logged.

**Non-negotiable.** Buckets are private from creation, including locally. A local habit of
public buckets becomes a production breach.
