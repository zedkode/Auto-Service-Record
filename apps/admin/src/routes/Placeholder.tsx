import { Card, EmptyState } from '@autoservices/ui'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <h1 className="mb-4 text-[18px] font-semibold tracking-tight">{title}</h1>
      <Card>
        <EmptyState
          title={`${title} is not built yet`}
          description="Admin modules are Phase 9. They are blocked on admin authentication (ADMIN-001) — exposing customer data through an unauthenticated internal tool would be worse than having no tool at all."
        />
      </Card>
    </>
  )
}
