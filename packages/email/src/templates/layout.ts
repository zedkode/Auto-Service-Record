/**
 * Email layout. Tables and inline styles, 600px max, no flexbox, no grid, no web fonts,
 * no background images carrying meaning — because it has to survive Outlook (EMAILS.md §3.1).
 */
export interface LayoutOptions {
  preheader: string
  heading: string
  body: string
  cta?: { label: string; url: string }
  footerNote?: string
  showPreferences?: boolean
}

const BRAND = '#1f5fd0'
const TEXT = '#10151c'
const MUTED = '#4a5566'
const BORDER = '#e8ebf0'

export function renderLayout(o: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fa;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;">
      <tr>
        <td style="padding:20px 28px;border-bottom:1px solid ${BORDER};">
          <span style="font:600 16px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">AutoServices</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0 0 12px;font:600 20px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">${escapeHtml(o.heading)}</h1>
          <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">${o.body}</div>
          ${
            o.cta
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
                  <tr><td style="background:${BRAND};border-radius:6px;">
                    <a href="${escapeAttr(o.cta.url)}" style="display:inline-block;padding:11px 22px;font:500 14px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">${escapeHtml(o.cta.label)}</a>
                  </td></tr>
                </table>
                <p style="margin:8px 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#78849a;">
                  If the button does not work, copy this link:<br>
                  <span style="color:${BRAND};word-break:break-all;">${escapeHtml(o.cta.url)}</span>
                </p>`
              : ''
          }
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px;border-top:1px solid ${BORDER};font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#78849a;">
          ${o.footerNote ? `<p style="margin:0 0 8px;">${escapeHtml(o.footerNote)}</p>` : ''}
          <p style="margin:0;">AutoServices${o.showPreferences ? ' · <a href="#" style="color:#78849a;">Notification preferences</a> · <a href="#" style="color:#78849a;">Unsubscribe</a>' : ''}</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

const escapeAttr = escapeHtml
