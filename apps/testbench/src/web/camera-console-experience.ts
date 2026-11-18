/** Operator layout. Existing camera actions and capability decisions remain authoritative. */
export interface ConsoleCamera {label:string;displayName:string;transport:{mode:string};health:{status:string;ptpResponsive?:boolean}}
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))

export function enhanceCameraConsole(root:HTMLElement,camera:ConsoleCamera|undefined,cameras:ConsoleCamera[]){
    const workspace=root.querySelector<HTMLElement>('.camera-control-workspace')
    const monitor=workspace?.querySelector<HTMLElement>('.camera-console-camera')
    const sidebar=workspace?.querySelector<HTMLElement>('.camera-console-sidebar')
    if(!workspace||!monitor||!sidebar)return
    workspace.classList.add('operator-workspace')
    let context=workspace.querySelector<HTMLElement>('.console-context')
    if(!context){
        context=document.createElement('header');context.className='console-context'
        context.innerHTML='<label class="console-camera-switch"><span>Camera</span><select data-console-camera-select aria-label="Switch camera"></select></label><div class="console-connection" role="status"></div><div class="console-action-feedback" role="status" aria-live="polite">Ready for a command</div><button class="button ghost" data-console-search-shortcut title="Search settings (⌘K / Ctrl+K)">Find a setting <kbd>⌘ K</kbd></button>'
        workspace.prepend(context)
    }
    const picker=context.querySelector<HTMLSelectElement>('select')!
    if(document.activeElement!==picker){picker.innerHTML=cameras.map(candidate=>`<option value="${escape(candidate.label)}" ${candidate.label===camera?.label?'selected':''}>${escape(candidate.displayName)}</option>`).join('')}
    const transport=camera?.transport.mode||'usb'
    const state=context.querySelector<HTMLElement>('.console-connection')!
    state.textContent=transport==='wifi-connected'?'Wi-Fi control':transport==='usb'?'USB control':'Wi-Fi setup in progress'
    state.dataset.transport=transport
    const quick=workspace.querySelector<HTMLElement>('.camera-console-quick-controls')
    if(quick){
        // Keep shooting controls above setup without taking height away from the picture.
        const heading=sidebar.querySelector('.console-settings-heading')
        if(heading)heading.after(quick);else sidebar.prepend(quick)
        quick.setAttribute('aria-label','Shooting controls')
        for(const card of quick.querySelectorAll<HTMLElement>('.canon-control-card')){
            const select=card.querySelector<HTMLSelectElement>('select')
            if(!select)continue
            select.setAttribute('aria-label',card.querySelector('.field > span')?.textContent||'Camera setting')
            const hint=card.querySelector('small')?.textContent?.trim();if(hint)select.title=hint
            if(card.closest('.camera-quick-exposure')&&!card.querySelector('[data-console-step]')){
                const controls=document.createElement('div');controls.className='console-setting-dial'
                const down=document.createElement('button'),up=document.createElement('button')
                for(const [button,direction,label] of [[down,-1,'Previous'],[up,1,'Next']] as const){
                    button.type='button';button.className='console-dial-step';button.dataset.consoleStep=String(direction)
                    button.textContent=direction<0?'−':'+';button.setAttribute('aria-label',`${label} ${select.getAttribute('aria-label')}`);button.disabled=select.disabled||select.options.length<2
                }
                select.before(controls);controls.append(down,select,up)
            }
        }
    }
    const zoom=workspace.querySelector<HTMLElement>('.camera-quick-zoom')
    if(zoom&&quick)quick.append(zoom)
    if(!sidebar.querySelector('.console-settings-heading')){
        const heading=document.createElement('div');heading.className='console-settings-heading'
        heading.innerHTML='<span class="eyebrow">Camera setup</span><p>Open only what you need.</p>'
        sidebar.prepend(heading)
    }
    const search=workspace.querySelector<HTMLInputElement>('[data-console-search]')
    if(search){search.placeholder='Find ISO, focus, Wi-Fi, recording…';search.setAttribute('aria-keyshortcuts','Meta+K Control+K')}
    // Retain useful explanations as tooltips; keep protocol details in their disclosure.
    for(const card of workspace.querySelectorAll<HTMLElement>('.canon-control-card')){
        const hint=card.querySelector('small')?.textContent?.trim()
        if(hint)card.title=hint
    }
}

export function setupConsoleExperience(switchCamera:(label:string)=>Promise<void>){
    const root=document.getElementById('canon-controls-body')!
    root.addEventListener('click',event=>{
        const target=(event.target as HTMLElement).closest<HTMLElement>('[data-console-step],[data-console-search-shortcut]')
        if(!target)return
        if(target.hasAttribute('data-console-search-shortcut')){root.querySelector<HTMLInputElement>('[data-console-search]')?.focus();return}
        const select=target.closest('.console-setting-dial')?.querySelector<HTMLSelectElement>('select')
        if(!select||select.disabled||root.querySelector('.console-is-applying'))return
        const index=Math.min(select.options.length-1,Math.max(0,select.selectedIndex+Number(target.dataset.consoleStep)))
        if(index!==select.selectedIndex){select.selectedIndex=index;select.dispatchEvent(new Event('change',{bubbles:true}))}
    })
    root.addEventListener('change',event=>{
        const target=event.target as HTMLSelectElement
        if(target.matches('[data-console-camera-select]'))void switchCamera(target.value)
    })
    document.addEventListener('keydown',event=>{
        const dialog=document.getElementById('canon-controls-dialog') as HTMLDialogElement
        if(dialog.open&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
            event.preventDefault();root.querySelector<HTMLInputElement>('[data-console-search]')?.focus()
        }
    })
}

export function consoleActionFeedback(message:string,state:'working'|'success'|'error'){
    const root=document.getElementById('canon-controls-body')
    const feedback=root?.querySelector<HTMLElement>('.console-action-feedback')
    if(!feedback)return
    feedback.textContent=message;feedback.dataset.state=state
    root?.classList.toggle('console-is-applying',state==='working')
}
