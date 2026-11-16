import { createHash, timingSafeEqual } from 'node:crypto'

const page = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Darkgrade · Telemetry</title>
<style>
:root{color-scheme:light dark;font:14px system-ui;background:light-dark(#fafafa,#141414);color:light-dark(#222,#eee)}
body{max-width:1240px;margin:36px auto;padding:0 20px}h1{font-size:22px;margin:0 0 20px}
form{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}input,button{font:inherit;padding:9px 12px;border:1px solid #8886;border-radius:6px;background:transparent;color:inherit}
input{min-width:140px;flex:1}button{cursor:pointer}table{width:100%;border-collapse:collapse;font-size:13px}
td,th{text-align:left;padding:10px;border-bottom:1px solid #8883;vertical-align:top}th{color:#888}code{font-size:12px}
.scroll{overflow:auto}#status{margin:12px 0;color:#888}tr[data-failed=true]{background:#f3333310}details{max-width:280px}pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style><h1>Camera diagnostics</h1>
<form id="filters"><input name="installation" aria-label="Installation ID" placeholder="Installation ID">
<input name="model" aria-label="Camera model" placeholder="Camera model"><input name="session" aria-label="Session ID" placeholder="Session ID">
<button>Load timeline</button></form><p id="status" role="status">Loading…</p>
<div class="scroll"><table><thead><tr><th>Time</th><th>Camera</th><th>Link</th><th>Operation</th><th>Result</th><th>Details</th></tr></thead><tbody id="events"></tbody></table></div>
<script>
const form=document.querySelector('form'),body=document.querySelector('#events'),status=document.querySelector('#status');
let controller;
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td}
async function load(){
controller?.abort();const active=controller=new AbortController();status.textContent='Loading…';
try {
const params=new URLSearchParams(new FormData(form));history.replaceState(null,'','/internal?'+params);
const response=await fetch('/internal/events?'+params,{signal:active.signal});
if(!response.ok)throw Error('Could not load diagnostics. Retry.');
const events=await response.json();body.replaceChildren();
for(const event of events){
const row=document.createElement('tr');row.dataset.failed=String(event.failed);
cell(row,new Date(event.occurred_at||event.received_at).toLocaleString());
const camera=cell(row,event.manufacturer+' '+event.model);camera.title='Firmware '+event.firmware+' · '+event.evidence;
cell(row,event.transport);cell(row,(event.properties.operation||event.kind)+(event.code===null?'':' · 0x'+event.code.toString(16)));
cell(row,event.failed?'❌ Error':event.kind==='response'&&event.code!==8193?'⚠️ Camera response':'✅ Observed');
const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
summary.textContent='Inspect';pre.textContent=JSON.stringify(event,null,2);details.append(summary,pre);cell(row,'').append(details);body.append(row);
}
status.textContent=events.length?events.length+' events · up to 500 latest observations':'No matching diagnostics.';
}catch(error){if(error.name!=='AbortError')status.textContent=error.message}
}
const initial=new URLSearchParams(location.search);for(const input of form.querySelectorAll('input'))input.value=initial.get(input.name)||'';
form.addEventListener('submit',event=>{event.preventDefault();load()});load();
</script></html>`

export function operatorAuthorized(request: Request, key: string | undefined) {
    if (!key || key.length < 32) return false
    const expected = `Basic ${Buffer.from(`outpost:${key}`).toString('base64')}`
    const hash = (value: string) => createHash('sha256').update(value).digest()
    return timingSafeEqual(hash(request.headers.get('authorization') ?? ''), hash(expected))
}

/** Optional operator-only view; browsers never receive the database or ingestion credential. */
export async function investigate(
    request: Request,
    key: string | undefined,
    timeline: (filters: {
        installation?: string
        model?: string
        session?: string
    }) => Promise<Record<string, unknown>[]>
) {
    if (!key || key.length < 32) return new Response('Not configured', { status: 404 })
    if (!operatorAuthorized(request, key))
        return new Response('Operator sign-in required', {
            status: 401,
            headers: { 'www-authenticate': 'Basic realm="Darkgrade telemetry", charset="UTF-8"' },
        })
    const url = new URL(request.url)
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    const headers = {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
            "default-src 'none'; script-src 'sha256-" +
            createHash('sha256').update(page.split('<script>')[1].split('</script>')[0]).digest('base64') +
            "'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    }
    if (url.pathname === '/internal')
        return new Response(page, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
    if (url.pathname !== '/internal/events') return new Response('Not found', { status: 404 })
    if (
        [...url.searchParams].some(
            ([key, value]) => !['installation', 'model', 'session'].includes(key) || value.length > 100
        )
    )
        return new Response('Invalid filters', { status: 400 })
    return Response.json(await timeline(Object.fromEntries(url.searchParams)), { headers })
}
