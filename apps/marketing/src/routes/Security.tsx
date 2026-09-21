import { Section, SectionHeading } from '../components/SiteLayout.js'

export function SecurityPage() {
  return (
    <>
      <Section className="pb-6 pt-14">
        <SectionHeading
          eyebrow="Security"
          title="Your vehicle documents are private"
          description="They contain names, addresses, registrations and sometimes bank details on an invoice. They are treated accordingly."
        />
      </Section>

      <Section className="pt-4">
        <div className="mx-auto max-w-3xl space-y-5">
          {[
            {
              title: 'Strict tenant isolation',
              body: 'Every workspace is isolated at three independent layers: the request guard, the data-access layer, and foreign keys in the database itself. A generated test suite proves that one workspace cannot reach another, and it blocks every release.',
            },
            {
              title: 'Modern password hashing',
              body: 'Passwords are hashed with Argon2id at OWASP-recommended parameters. They are never recoverable — not by us, not by support, not by an administrator.',
            },
            {
              title: 'Hashed session and reset tokens',
              body: 'Only hashes are stored. A database leak would not yield a usable session or a working password-reset link.',
            },
            {
              title: 'Private document storage',
              body: 'Documents live in private object storage with unguessable, tenant-namespaced keys. Every download is permission-checked and served through a link that expires in five minutes.',
            },
            {
              title: 'Audited administrative access',
              body: 'Support staff cannot browse customer documents by default. Access requires a time-boxed grant with a written reason, and every action is recorded in an append-only audit log.',
            },
            {
              title: 'Your data, on request',
              body: 'Export your data or delete your account. Deletion has a documented workflow covering shared workspaces, so removing your account never destroys someone else’s records.',
            },
          ].map((s) => (
            <div
              key={s.title}
              className="rounded-xl border border-border-subtle bg-surface-raised p-6"
            >
              <h3 className="text-[15.5px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-content-secondary">{s.body}</p>
            </div>
          ))}

          {/* Honesty matters more than a trust badge. */}
          <div className="rounded-xl border border-border-default bg-surface-sunken p-6">
            <h3 className="text-[15.5px] font-semibold">What we do not claim</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-content-secondary">
              We are not SOC 2, ISO 27001 or PCI-DSS certified, and we will not display a badge
              suggesting otherwise. This page describes controls that are designed and implemented,
              not an audit we have not undergone.
            </p>
          </div>
        </div>
      </Section>
    </>
  )
}
