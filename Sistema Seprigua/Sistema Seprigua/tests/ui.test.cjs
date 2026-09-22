const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),path=require('node:path');
const base=path.resolve(__dirname,'..')+path.sep,calls=[],errors=[],delay=ms=>new Promise(r=>setTimeout(r,ms));let slow=false;
const dom=new JSDOM(fs.readFileSync(base+'sistema.html','utf8'),{url:'http://example.test/sistema/coordinador?modulo=ordenes',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.lucide={createIcons(){}};w.scrollTo=()=>{};w.confirm=()=>true;w.addEventListener('error',e=>errors.push(e.message));
const order=id=>({id,numero:'OT-'+id,cliente:'Cliente de prueba',tipo:'Drenajes',estado:'PENDIENTE',estado_codigo:'PENDIENTE',sede:'Norte',prioridad:'MEDIA'});
w.fetch=async(url,opt={})=>{const u=new URL(url,'http://example.test'),p=u.pathname;calls.push({p,method:opt.method||'GET',body:opt.body});if(p==='/api/ordenes'&&slow){await delay(60);if(opt.signal.aborted)throw new w.DOMException('Aborted','AbortError');}
let d={ok:true,items:[],pagina:1,paginas:1,total:0,tamano:10};
if(p==='/api/auth/me')d={ok:true,user:{usuario_id:4,rol:'COORDINADOR',nombre:'Prueba',empleado_id:12}};
else if(p==='/api/catalogos')d={ok:true,tipos_servicio:[{id:1,nombre:'Drenajes'}],clientes:[],tecnicos:[{id:12,nombre:'Técnico'}],equipos:[{id:1,nombre:'Bomba',codigo:'E-1'}],estados_orden:[]};
else if(p==='/api/db/health')d={ok:true,system_migration:true};
else if(p==='/api/notificaciones/resumen')d={ok:true,no_leidas:0,items:[]};
else if(p==='/api/ordenes'){const page=Number(u.searchParams.get('pagina')||1),size=Number(u.searchParams.get('tamano')||10);d={ok:true,items:Array.from({length:Math.min(size,105-(page-1)*size)},(_,i)=>order((page-1)*size+i+1)),pagina:page,paginas:Math.ceil(105/size),total:105,tamano:size};}
else if(p==='/api/equipos')d={...d,items:[{id:1,codigo:'E-1',nombre:'Bomba',estado:'DISPONIBLE',activo:true}],total:1};
else if(p==='/api/equipos/1')d={ok:true,item:{EquipoId:1,Nombre:'Bomba',CodigoEquipo:'E1',Activo:true,Estado:'DISPONIBLE'},fallas:[],inspecciones:[],mantenimientos:[]};
else if(p==='/api/personal')d={...d,items:[{id:12,nombre:'Técnico',estado:'ACTIVO'}],total:1};
else if(p==='/api/catalogo-maestro')d={...d,items:[{id:'custom:8',concepto_id:8,codigo:'C8',nombre:'Limpieza',descripcion:'Limpieza',unidad:'Servicio',precio:100,activo:true}],total:1};
else if(p==='/api/cotizaciones'&&opt.method==='POST')d={ok:true,item:{id:7}};
else if(p==='/api/mantenimientos')d={...d,items:[{id:1,equipo:'Bomba',codigo_equipo:'E-1',tipo:'PREVENTIVO',estado:'PROGRAMADO'}],total:1};
else if(p==='/api/mantenimientos/1')d={ok:true,item:{MantenimientoEquipoId:1,Equipo:'Bomba',Estado:'PROGRAMADO',TipoMantenimiento:'PREVENTIVO'},repuestos:[]};
else if(p==='/api/garantias')d={ok:true,items:[],solicitudes:[],resumen:{}};
else if(p==='/api/usuarios/catalogos')d={ok:true,roles:[],empleados:[],contactos:[]};
else if(p==='/api/usuarios')d={ok:true,items:[],pagination:{total:0,pagina:1,paginas:1},summary:{}};
return {ok:true,status:200,json:async()=>d};};
const $=s=>w.document.querySelector(s),click=s=>{const el=$(s);assert(el,'Missing '+s);el.click();};
(async()=>{try{
w.eval(fs.readFileSync(base+'java/portal-ui.js','utf8'));const script=fs.readFileSync(base+'java/sistema.js','utf8');w.eval(script);w.eval(script);await delay(30);
assert.equal(calls.filter(x=>x.p==='/api/auth/me').length,1);assert.equal($('#pageTitle').textContent,'Órdenes de trabajo');assert($('.portal-pagination').textContent.includes('105 registros'));
click('#listNext');await delay(20);assert($('#appContent').textContent.includes('OT-11'));
slow=true;click('[data-module="ordenes"]');await delay(2);click('[data-module="equipos"]');await delay(90);assert.equal($('#pageTitle').textContent,'Equipo');assert(!$('#appContent').textContent.includes('OT-'));slow=false;
for(const module of ['solicitudes','personal','mantenimientos','vacaciones','cotizaciones','documentos','auditoria','usuarios','garantia','notificaciones']){click(`[data-module="${module}"]`);await delay(15);assert(!$('#appContent').textContent.includes('No se pudo'));}
click('[data-module="cotizaciones"]');await delay(15);click('[data-action="nueva-cotizacion"]');await delay(20);assert.equal($('#quoteFullForm [name="orden_id"]').options.length,105);
const cat=$('[data-catalog="0"]');cat.value='custom:8';cat.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal($('[data-field="precio"]').value,'100');
const f=$('#quoteFullForm');f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await delay(30);const saved=calls.filter(x=>x.p==='/api/cotizaciones'&&x.method==='POST');assert.equal(saved.length,1);assert.equal(JSON.parse(saved[0].body).lineas[0].concepto_id,8);
click('[data-module="equipos"]');await delay(15);click('[data-action="detalle-equipo"]');await delay(15);assert($('#modalBody').textContent.includes('Registrar inspección'));click('[data-action="editar-equipo"]');await delay(15);assert($('#editEquipment'));click('#modalClose');
click('[data-module="mantenimientos"]');await delay(15);click('[data-action="detalle-mantenimiento"]');await delay(15);assert($('#maintenanceProgress'));assert.deepEqual(errors,[]);console.log('UI scenarios passed (simulated DOM, no layout engine).');
}finally{w.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
