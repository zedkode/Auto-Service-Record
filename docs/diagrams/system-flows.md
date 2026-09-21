# System Flow Diagrams

Mermaid source. Rendered by GitHub and most Markdown viewers.

## 1. Reminder to email — the full trace

The path one identifier (`correlationId`) must be traceable along end to end.

```mermaid
sequenceDiagram
    autonumber
    participant S as Scheduler (worker)
    participant DB as PostgreSQL
    participant Q as BullMQ (Redis)
    participant W as Email worker
    participant R as Resend
    participant API as API
    participant U as User

    Note over S: hourly, per timezone bucket at 09:00 local
    S->>DB: scan sources for due candidates
    DB-->>S: maintenance rules, expiries
    S->>DB: upsert reminders, SCHEDULED → DUE
    S->>DB: insert notification (in-app, immediate)
    S->>DB: insert notification_delivery (idempotency_key)
    Note over S,DB: unique violation here = already handled, stop
    S->>Q: enqueue email job

    Q->>W: deliver job
    W->>DB: check preferences + suppression list
    W->>DB: insert email_messages (QUEUED) BEFORE sending
    W->>R: send rendered HTML + text
    R-->>W: provider_message_id
    W->>DB: status → SENT

    R->>API: POST /webhooks/resend (signed)
    API->>API: verify signature, reject if > 5 min old
    API->>Q: enqueue webhook processing, return 202
    Q->>W: process event
    W->>DB: append email_delivery_events (unique provider_event_id)
    W->>DB: advance email_messages.status by rank

    U->>API: opens dashboard
    API->>DB: fetch notifications
    API-->>U: notification centre
```

## 2. Tenant isolation — three layers

```mermaid
flowchart TD
    A[HTTP request] --> B{SessionGuard}
    B -->|no valid session| B1[401 UNAUTHENTICATED]
    B -->|user resolved| C{WorkspaceGuard}
    C -->|no ACTIVE membership| C1["404 NOT_FOUND<br/>(not 403 — 403 confirms existence)"]
    C -->|membership resolved| D{PermissionGuard}
    D -->|role lacks permission| D1[403 PERMISSION_DENIED]
    D -->|permitted| E{EntitlementGuard}
    E -->|plan limit reached| E1[402 PLAN_LIMIT_REACHED]
    E -->|within limits| F[Controller]
    F --> G[Service]
    G --> H["LAYER 2<br/>Prisma tenant extension<br/>injects workspaceId"]
    H --> I["LAYER 3<br/>Composite FK (id, workspace_id)<br/>database rejects mismatch"]
    I --> J[(PostgreSQL)]

    style C1 fill:#fee,stroke:#c00
    style H fill:#eef,stroke:#00c
    style I fill:#efe,stroke:#0a0
```

## 3. Service entry — one form, five consequences

Why the user enters a service once and never maintains the rest by hand.

```mermaid
flowchart LR
    A[User submits service] --> T{{Single transaction}}
    T --> B[service_records row]
    T --> C[service_parts rows]
    T --> D["odometer_entries row<br/>source = SERVICE"]
    T --> E["maintenance_rules advanced<br/>next due recomputed"]
    T --> F["expenses projection<br/>source_type = SERVICE"]
    T --> G["vehicles.current_odometer<br/>cache refreshed"]
    B --> H[Timeline shows the event]
    E --> I[Reminders re-evaluated]
    D --> I
```

## 4. Document upload — the file never touches the API

```mermaid
sequenceDiagram
    participant C as Browser
    participant API as API
    participant S3 as Object storage
    participant W as Worker

    C->>API: POST /documents/upload-sessions<br/>filename, contentType, size, checksum
    API->>API: validate type, extension, size vs plan limits
    API->>API: create document row (PENDING)
    API-->>C: presigned PUT (15 min) + documentId

    C->>S3: PUT file directly
    S3-->>C: 200

    C->>API: POST /documents/{id}/finalise
    API->>S3: HEAD object — exists? size? checksum?
    alt verification passes
        API->>API: status → AVAILABLE, storage counters updated
        API-->>C: document metadata
    else verification fails
        API-->>C: 409 CHECKSUM_MISMATCH
    end

    Note over W: nightly
    W->>S3: reap objects with no AVAILABLE row
    W->>API: purge documents soft-deleted > 30 days
```
