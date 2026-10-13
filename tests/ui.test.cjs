const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const {backend}=require('./ui-fixture.cjs'),base=path.resolve(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function portal(b,profile='COORDINADOR',module='dashboard'){
 const role=['SUPERVISOR','OPERARIO'].includes(profile)?'TECNICO':profile;
 const dom=new JSDOM(fs.readFileSync(base+'/sistema.html','utf8'),{url:'http://test.local/sistema/'+role.toLowerCase(),runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[];
 w.sessionStorage.setItem('seprigua_modulo_'+profile,module);w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.CSS={escape:x=>String(x)};w.lucide={createIcons(){}};w.scrollTo=()=>{};w.confirm=()=>true;w.requestAnimationFrame=f=>setTimeout(f,0);w.HTMLElement.prototype.scrollTo=()=>{};
 w.addEventListener('error',e=>errors.push(e.message));w.fetch=async(url,opt={})=>{const d=b.handle(url,opt.method||'GET',typeof opt.body==='string'?JSON.parse(opt.body):{},profile);return {ok:d.ok!==false,status:d.__status||200,json:async()=>d};};
 for(const f of ['portal-ui.js','operations-ui.js','sistema.js'])w.eval(fs.readFileSync(base+'/java/'+f,'utf8'));
 for(let i=0;i<200&&w.document.body.classList.contains('ui-booting');i++)await delay(10);await delay(30);const $=s=>w.document.querySelector(s);const click=async s=>{assert($(s),'Missing '+s);$(s).click();await delay(150);};
 const submit=async(s,values)=>{const f=$(s);assert(f,'Missing '+s);for(const[k,v]of Object.entries(values))f.elements[k].value=v;f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await delay(150);};
 return {dom,w,$,click,submit,errors,close:()=>w.close()};
}
async function run(){const b=backend();let p;
 try{
 p=await portal(b,'COORDINADOR','ordenes');assert(p.$('#pageTitle').textContent.includes('Órdenes'));assert(p.$('.order-list-pagination,.orders-pagination,.order-pagination')||p.$('[data-action="smart-page"]'));
 await p.click('[data-action="smart-page"][data-page="2"]');assert(p.$('[data-action="smart-page"][data-page="2"].active'),'Second page selected');p.close();
 p=await portal(b,'OPERARIO','vacaciones');await p.click('[data-action="nueva-vacacion"]');await p.submit('#vacationForm',{inicio:'2027-02-01',fin:'2027-02-02',motivo:'Descanso solicitado'});assert.equal(b.state.vacations.length,1);p.close();
 p=await portal(b,'COORDINADOR','vacaciones');await p.click('[data-action="detalle-vacacion"]');await p.submit('#vacationForm',{estado:'APROBADA',observaciones:'Solicitud aprobada'});assert.equal(b.state.vacations[0].estado,'APROBADA');p.close();
 p=await portal(b,'SUPERVISOR','vacaciones');assert(p.$('#appContent').textContent.includes('APROBADA')||p.$('#appContent').textContent.includes('Aprobada'));p.close();
 p=await portal(b,'COORDINADOR','cotizaciones');await p.click('[data-action="nueva-cotizacion"]');assert.equal(p.$('#quoteFullForm [name="orden_id"]').options.length,105);let select=p.$('[data-catalog="0"]');select.value='custom:8';select.dispatchEvent(new p.w.Event('change',{bubbles:true}));assert.equal(p.$('[data-field="precio"]').value,'100');
 await p.submit('#quoteFullForm',{});assert.equal(b.state.quotes.length,1);assert.equal(b.state.quotes[0].lineas[0].concepto_id,8);p.close();
 p=await portal(b,'CLIENTE','solicitudes');await p.click('[data-action="solicitar-cancelacion"]');await p.submit('#cancelRequest',{motivo:'Ya no se requiere el servicio'});assert.equal(b.state.cancellations.length,1);p.close();
 p=await portal(b,'COORDINADOR','cancelaciones');await p.click('[data-action="resolver-cancelacion"]');await p.submit('#cancelResolve',{estado:'RECHAZADA',observaciones:'Servicio confirmado con el cliente'});assert.equal(b.state.cancellations[0].estado,'RECHAZADA');p.close();
 p=await portal(b,'CLIENTE','cancelaciones');p.$('#cancellationStatus').value='RECHAZADA';p.$('#cancellationStatus').dispatchEvent(new p.w.Event('change'));await delay(35);assert(p.$('#appContent').textContent.includes('Servicio confirmado'));assert.deepEqual(p.errors,[]);p.close();
 for(const module of ['personal','equipos','mantenimientos','produccion','documentos','auditoria','usuarios','garantia','notificaciones','cuenta']){p=await portal(b,'COORDINADOR',module);assert(!p.$('#appContent').textContent.includes('No se pudo'),module);assert.deepEqual(p.errors,[],module);p.close();}
 const original=b.handle;b.handle=(...args)=>{const d=original(...args);if(String(args[0]).startsWith('/api/solicitudes'))d.items.forEach(x=>x.descripcion='<img id="xss-fixture" src=x onerror="alert(1)">');return d;};p=await portal(b,'CLIENTE','solicitudes');assert(!p.$('#xss-fixture'));assert(p.$('#appContent').textContent.includes('<img id='));p.close();
 console.log('UI: pagination, quote/catalog, vacation approval + reload, cancellation resolution + reload, 10 module renders passed (in-memory API).');
 }finally{p?.close();}}
module.exports={portal};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
