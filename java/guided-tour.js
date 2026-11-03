/* Tour operativo SEPRIGUA. Solo observa la interfaz y consulta APIs de lectura. */
(() => {
  "use strict";

  const TOUR_ID = "flujo-principal-atencion";
  const VERSION = 2;
  const POLL_MS = 25000;
  const $ = selector => document.querySelector(selector);
  const all = selector => [...document.querySelectorAll(selector)];
  const numberId = value => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };
  const upper = value => String(value || "").trim().toUpperCase();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const moduleLabels = {dashboard:"Centro de control",solicitudes:"Solicitudes",ordenes:"Órdenes de trabajo",agenda:"Agenda operativa",cotizaciones:"Cotizaciones",clientes:"Clientes y personal",equipos:"Equipo y mantenimiento",documentos:"Documentos",garantia:"Garantías",notificaciones:"Notificaciones",auditoria:"Auditoría"};

  // Cada control se identifica por IDs y data-attributes que ya utiliza el sistema.
  // completionCondition se consulta contra la interfaz o los registros del servidor.
  const FLOW = {
    navRequests: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_ROUTE",stage:1,title:"Entra a Solicitudes",text:"Abre Solicitudes para revisar el origen del servicio.",target:()=> '#systemNav [data-module="solicitudes"]',completionCondition:c=>c.module==="solicitudes"},
    chooseRequest: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_CLICK",stage:2,title:"Abre una solicitud",text:"Pulsa Ver seguimiento en la solicitud que atenderás. Comprueba sus datos antes de seguir.",target:c=>`#appContent [data-action="ver-solicitud"][data-id="${c.requestId || c.firstRequestId}"]`,completionCondition:c=>!!c.request},
    newRequest: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_CLICK",stage:2,title:"Registra una solicitud",text:"No hay una solicitud visible para continuar. Pulsa Nueva solicitud para registrar el caso real.",target:()=> '#appContent [data-action="nueva-solicitud"]',completionCondition:()=>!!$("#requestForm")},
    requestField: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_FORM",stage:2,title:c=>c.fieldTitle,text:c=>c.fieldText,target:c=>c.fieldTarget,completionCondition:c=>!!c.fieldReady},
    requestSave: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_STATE_CHANGE",stage:2,title:"Guarda la solicitud",text:"Revisa lo ingresado y pulsa Guardar solicitud. Continuaremos solo cuando el servidor confirme el registro.",target:()=> '#requestForm button[type="submit"]',completionCondition:c=>!!c.requestId && !!c.request},
    requestSearch: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_FORM",stage:2,title:"Encuentra esta solicitud",text:c=>`Busca la solicitud #${c.requestId} o ajusta los filtros para abrir su seguimiento.`,target:()=> '#appContent [data-smart-q="solicitudes"]',completionCondition:c=>!!c.requestModal},
    createOrder: {actor:"COORDINADOR",action:"ACTION_CLICK",stage:3,title:"Genera la orden de trabajo",text:"Ya revisaste la solicitud. Pulsa Crear OT si corresponde atenderla; la solicitud quedará vinculada a la orden.",target:()=> '#modalBackdrop:not([hidden]) [data-action="crear-ot-solicitud"]',completionCondition:c=>!!c.orderId && !!c.order},
    orderForm: {actor:"COORDINADOR",action:"ACTION_FORM",stage:3,title:"Revisa y crea la OT",text:"Comprueba la solicitud, prioridad y fecha aproximada. Pulsa Crear OT y asignar cuadrilla; avanzaremos cuando exista la orden.",target:()=> '#orderForm button[type="submit"]',completionCondition:c=>!!c.orderId && !!c.order},
    navOrders: {actor:["COORDINADOR","TECNICO","CLIENTE"],action:"ACTION_ROUTE",stage:4,title:"Entra a Órdenes",text:"Abre el módulo de órdenes para continuar con la atención de este servicio.",target:()=> '#systemNav [data-module="ordenes"]',completionCondition:c=>c.module==="ordenes"},
    openOrder: {actor:["COORDINADOR","TECNICO","CLIENTE"],action:"ACTION_CLICK",stage:4,title:"Abre la orden",text:c=>c.orderId?`Pulsa Ver detalle en la OT #${c.orderId}. Revisaremos su estado real antes de seguir.`:"Abre una de tus órdenes asignadas para consultar el trabajo.",target:c=>c.orderId?`#appContent [data-action="ver-orden"][data-id="${c.orderId}"]`:'#appContent [data-action="ver-orden"]',completionCondition:c=>!!c.order && c.orderOpen},
    orderSearch: {actor:["COORDINADOR","TECNICO","CLIENTE"],action:"ACTION_FORM",stage:4,title:"Encuentra la OT",text:c=>`Busca la OT #${c.orderId} o ajusta los filtros para abrir su detalle.`,target:()=> '#appContent [data-smart-q="ordenes"]',completionCondition:c=>c.orderOpen},
    openCrew: {actor:"COORDINADOR",action:"ACTION_CLICK",stage:5,title:"Gestiona la cuadrilla",text:"La OT aún no tiene personal activo. Abre Gestionar cuadrilla para elegir quién atenderá el servicio.",target:()=> '.order-workspace [data-action="asignar-tecnico"]',completionCondition:c=>!!$("#crewForm") || c.hasCrew},
    crewChoose: {actor:"COORDINADOR",action:"ACTION_FORM",stage:5,title:"Selecciona la cuadrilla",text:"Marca al personal adecuado y deja exactamente un Encargado. La disponibilidad y la cola se muestran en cada tarjeta.",target:()=> '#crewForm .crew-manager-list',completionCondition:c=>c.crewFormReady},
    crewSave: {actor:"COORDINADOR",action:"ACTION_STATE_CHANGE",stage:5,title:"Guarda la cuadrilla",text:"Pulsa Guardar cuadrilla. El paso termina cuando la OT confirma que hay personal asignado.",target:()=> '#crewForm button[type="submit"]',completionCondition:c=>c.hasCrew},
    navAgenda: {actor:"COORDINADOR",action:"ACTION_ROUTE",stage:6,title:"Consulta la agenda",text:"La OT tiene fecha aproximada. Abre Agenda operativa para ver cómo queda dentro de la planificación.",target:()=> '#systemNav [data-module="agenda"]',completionCondition:c=>c.module==="agenda"},
    navWarranty: {actor:"COORDINADOR",action:"ACTION_ROUTE",stage:12,title:"Abre Garantías",text:"La OT ya terminó, pero su plazo de garantía sigue pendiente de configurar. Abre Garantías para completar esa continuidad.",target:()=> '#systemNav [data-module="garantia"]',completionCondition:c=>c.module==="garantia"},
    configureWarranty: {actor:"COORDINADOR",action:"ACTION_CLICK",stage:12,title:"Configura la garantía",text:"Selecciona Configurar garantía en la OT finalizada. El plazo se contará desde la fecha real de finalización.",target:c=>`#appContent [data-action="configurar-garantia"][data-id="${c.orderId}"]`,completionCondition:()=>!!$("#warrantyConfigForm")},
    warrantyDays: {actor:"COORDINADOR",action:"ACTION_FORM",stage:12,title:"Indica el plazo",text:"Registra los días de garantía que correspondan a este trabajo.",target:()=> '#warrantyConfigForm [name="dias"]',completionCondition:()=>!!$('#warrantyConfigForm [name="dias"]')?.value},
    saveWarranty: {actor:"COORDINADOR",action:"ACTION_STATE_CHANGE",stage:12,title:"Guarda la garantía",text:"Pulsa Guardar garantía. El tour esperará a que el registro deje de estar pendiente de configuración.",target:()=> '#warrantyConfigForm button[type="submit"]',completionCondition:c=>c.warrantyCode!=="PENDIENTE_CONFIGURACION"},
    startOrder: {actor:"TECNICO",action:"ACTION_STATE_CHANGE",stage:7,title:"Inicia el trabajo",text:"Comprueba los datos de la OT y pulsa Iniciar trabajo cuando corresponda. El avance se verifica en el estado de la orden.",target:()=> '.order-workspace [data-action="iniciar-orden"]',completionCondition:c=>["EN_PROCESO","POR_CONFIRMAR","COMPLETADA"].includes(c.orderCode)},
    tabDocument: {actor:["TECNICO","COORDINADOR"],action:"ACTION_CLICK",stage:8,title:"Abre ticket y respaldo",text:"Consulta el ticket y el respaldo físico. La hoja física es opcional; si registras un número, adjunta su archivo.",target:()=> '.order-workspace [data-action="orden-paso"][data-step="documento"]',completionCondition:c=>c.orderStep==="documento"},
    saveDocument: {actor:["TECNICO","COORDINADOR"],action:"ACTION_STATE_CHANGE",stage:8,title:"Guarda el respaldo",text:"Completa el ticket obligatorio o el par número/archivo de la hoja física. Continuaremos cuando la OT confirme el requisito.",target:()=> '#orderDocForm button[type="submit"]',completionCondition:c=>c.documentReady},
    tabEvidence: {actor:["TECNICO","COORDINADOR"],action:"ACTION_CLICK",stage:9,title:"Abre Evidencia",text:"En esta pantalla se guardan las fotografías del trabajo que exige la OT.",target:()=> '.order-workspace [data-action="orden-paso"][data-step="evidencia"]',completionCondition:c=>c.orderStep==="evidencia"},
    evidenceFile: {actor:["TECNICO","COORDINADOR"],action:"ACTION_FORM",stage:9,title:"Selecciona fotografías",text:"Elige las fotos reales del servicio. La OT indica la cantidad mínima para el cierre.",target:()=> '#orderEvidenceForm [name="archivos"]',completionCondition:()=>!!$("#orderEvidenceForm [name='archivos']")?.files?.length},
    evidenceSave: {actor:["TECNICO","COORDINADOR"],action:"ACTION_STATE_CHANGE",stage:9,title:"Guarda la evidencia",text:"Pulsa Subir y continuar. Avanzaremos cuando las fotografías queden registradas en la OT.",target:()=> '#orderEvidenceForm button[type="submit"]',completionCondition:c=>c.photosReady},
    tabDescription: {actor:["TECNICO","COORDINADOR"],action:"ACTION_CLICK",stage:10,title:"Abre Descripción",text:"Registra qué trabajo se realizó y las observaciones para el seguimiento del servicio.",target:()=> '.order-workspace [data-action="orden-paso"][data-step="descripcion"]',completionCondition:c=>c.orderStep==="descripcion"},
    descriptionField: {actor:["TECNICO","COORDINADOR"],action:"ACTION_FORM",stage:10,title:"Describe el servicio",text:"Escribe las actividades realizadas. Puedes añadir hallazgos o recomendaciones en Observaciones.",target:()=> '#orderDescriptionForm [name="descripcion"]',completionCondition:()=>!!$("#orderDescriptionForm [name='descripcion']")?.value.trim()},
    descriptionSave: {actor:["TECNICO","COORDINADOR"],action:"ACTION_STATE_CHANGE",stage:10,title:"Guarda la descripción",text:"Pulsa Guardar y continuar. Avanzaremos al verificar la actividad en el registro de la OT.",target:()=> '#orderDescriptionForm button[type="submit"]',completionCondition:c=>c.descriptionReady},
    tabFinish: {actor:["TECNICO","COORDINADOR"],action:"ACTION_CLICK",stage:11,title:"Revisa el cierre",text:"Abre Finalizar OT y comprueba los requisitos antes de cerrar el servicio.",target:()=> '.order-workspace [data-action="orden-paso"][data-step="finalizar"]',completionCondition:c=>c.orderStep==="finalizar"},
    finishOrder: {actor:["TECNICO","COORDINADOR"],action:"ACTION_STATE_CHANGE",stage:11,title:"Finaliza la OT",text:"Cuando todas las comprobaciones estén completas, pulsa Marcar OT como finalizada. Esperaremos la confirmación real del servidor.",target:()=> '.order-workspace [data-action="finalizar-tecnico"]:not(:disabled)',completionCondition:c=>c.orderCode==="COMPLETADA"},
    openQuote: {actor:"COORDINADOR",action:"ACTION_CLICK",stage:6,title:"Crea la cotización",text:"Si esta atención necesita propuesta económica, ábrela desde la OT. Solo puede crearse mientras la orden está abierta.",target:()=> '.order-workspace [data-action="cotizar-orden"]',completionCondition:()=>!!$("#quoteFullForm")},
    saveQuote: {actor:"COORDINADOR",action:"ACTION_STATE_CHANGE",stage:6,title:"Guarda la cotización",text:"Revisa los conceptos y condiciones. Guarda la propuesta; continuaremos cuando quede vinculada a la OT.",target:()=> '#quoteFullForm button[type="submit"]',completionCondition:c=>!!c.quote},
    navQuotes: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_ROUTE",stage:6,title:"Entra a Cotizaciones",text:"Abre Cotizaciones para continuar con la propuesta vinculada a este servicio.",target:()=> '#systemNav [data-module="cotizaciones"]',completionCondition:c=>c.module==="cotizaciones"},
    sendQuote: {actor:"COORDINADOR",action:"ACTION_STATE_CHANGE",stage:6,title:"Envía la cotización",text:"La propuesta está en borrador. Pulsa Enviar para que el cliente pueda responder; el tour verificará el nuevo estado.",target:c=>`[data-action="enviar-cotizacion"][data-id="${c.quoteId}"]`,completionCondition:c=>c.quoteCode==="ENVIADA"},
    quoteDetail: {actor:["COORDINADOR","CLIENTE"],action:"ACTION_CLICK",stage:6,title:"Abre la cotización",text:"Consulta el expediente o el detalle de la propuesta vinculada a esta OT.",target:c=>`#appContent [data-action="ver-expediente-cotizacion"][data-id="${c.quoteId}"]`,completionCondition:()=>!!$('.quote-flow-hero') || /Cotización/i.test($('#modalTitle')?.textContent||"")},
    reviseQuote: {actor:"COORDINADOR",action:"ACTION_CLICK",stage:6,title:"Prepara una nueva versión",text:"El cliente pidió cambios o rechazó la propuesta. Abre Nueva versión y revisa las condiciones antes de volver a enviar.",target:()=> '#modalBackdrop:not([hidden]) [data-action="version-cotizacion"]',completionCondition:()=>!!$("#quoteFullForm")},
    clientQuoteResponse: {actor:"CLIENTE",action:"ACTION_CLICK",stage:6,title:"Responde la cotización",text:"La propuesta fue enviada. Abre Responder cotización para aceptar, solicitar cambios o rechazar según corresponda.",target:()=> '#appContent [data-action="responder-cotizacion"]',completionCondition:()=>!!$("#quoteResponse")},
    clientQuoteChoice: {actor:"CLIENTE",action:"ACTION_FORM",stage:6,title:"Elige tu respuesta",text:"Selecciona Aceptar, Solicitar cambios o Rechazar. Los cambios o rechazo requieren una observación.",target:()=> '#quoteResponse [name="respuesta"]',completionCondition:()=>!!$('#quoteResponse [name="respuesta"]')?.value},
    clientQuoteSave: {actor:"CLIENTE",action:"ACTION_STATE_CHANGE",stage:6,title:"Envía tu respuesta",text:"Pulsa Enviar respuesta. Avanzaremos cuando la cotización cambie realmente de estado.",target:()=> '#quoteResponse button.btn.primary',completionCondition:c=>c.quoteCode!=="ENVIADA"},
    decideReprogram: {actor:"COORDINADOR",action:"ACTION_CLICK",stage:8,title:"Resuelve la reprogramación",text:"La OT está suspendida. Abre Aprobar o rechazar y revisa la fecha propuesta antes de decidir.",target:()=> '.order-workspace [data-action="decidir-reprogramacion"]',completionCondition:()=>!!$("#decideRescheduleForm")},
    saveReprogram: {actor:"COORDINADOR",action:"ACTION_STATE_CHANGE",stage:8,title:"Guarda la decisión",text:"Aprueba y programa o rechaza desde este formulario. El tour espera a que desaparezca la solicitud pendiente.",target:()=> '#decideRescheduleForm .form-actions',completionCondition:c=>!c.pendingReprogram},
    sendScope: {actor:"COORDINADOR",action:"ACTION_STATE_CHANGE",stage:8,title:"Informa el cambio de alcance",text:"Hay un cambio pendiente. Pulsa Enviar al cliente para solicitar su respuesta antes del cierre.",target:()=> '.order-workspace [data-action="enviar-cambio"]',completionCondition:c=>!c.scopeUnsent},
    respondScope: {actor:"CLIENTE",action:"ACTION_CLICK",stage:8,title:"Responde el cambio de alcance",text:"Coordinación informó un cambio. Abre Responder para autorizar, rechazar o proponer una alternativa.",target:()=> '.order-workspace [data-action="responder-cambio"]',completionCondition:()=>!!$("#scopeResponse")},
    saveScope: {actor:"CLIENTE",action:"ACTION_STATE_CHANGE",stage:8,title:"Guarda tu respuesta",text:"Envía tu decisión. El proceso continuará cuando el cambio deje de estar pendiente.",target:()=> '#scopeResponse .btn.primary',completionCondition:c=>!c.scopePending},
    waitCoordinator: {actor:"COORDINADOR",action:"ACTION_WAIT",stage:5,title:"Esperando a Coordinación",text:"La siguiente acción corresponde a Coordinación. Volveremos a consultar esta OT cuando haya cambios.",target:null,completionCondition:c=>!c.pendingReprogram && c.hasCrew},
    waitTechnicianStart: {actor:"TECNICO",action:"ACTION_WAIT",stage:7,title:"Esperando al técnico",text:"La OT ya tiene personal asignado. El técnico puede iniciar el trabajo; al detectar ese cambio, el tour mostrará la siguiente etapa.",target:null,completionCondition:c=>["EN_PROCESO","POR_CONFIRMAR","COMPLETADA"].includes(c.orderCode)},
    waitTechnicianFinish: {actor:"TECNICO",action:"ACTION_WAIT",stage:8,title:"Trabajo en ejecución",text:"El técnico ya inició la OT. Ahora debe registrar las evidencias y descripción requeridas y completar el cierre técnico.",target:null,completionCondition:c=>c.orderCode==="COMPLETADA"},
    waitClient: {actor:"CLIENTE",action:"ACTION_WAIT",stage:6,title:"Esperando al cliente",text:"La cotización o un cambio de alcance requiere respuesta del cliente. El tour consultará el registro hasta que cambie realmente.",target:null,completionCondition:c=>c.quoteCode!=="ENVIADA" && !c.scopePending},
    choiceQuote: {actor:"COORDINADOR",action:"ACTION_INFO",stage:6,title:"¿Esta OT requiere cotización?",text:"La cotización es opcional en el flujo actual. Si aplica, se gestiona mientras la OT está abierta; el cierre técnico sigue sus propias reglas.",target:null,completionCondition:c=>c.quoteChoice!==null},
    cancelled: {actor:"SISTEMA",action:"ACTION_INFO",stage:1,title:"Proceso cancelado",text:"Este registro figura como cancelado. Selecciona otro servicio para iniciar un flujo operativo distinto.",target:null,completionCondition:()=>false},
    complete: {actor:"SISTEMA",action:"ACTION_INFO",stage:12,title:"Flujo completado",text:"La OT aparece como completada. Su historial, evidencias y avisos permanecen disponibles para los usuarios relacionados.",target:null,completionCondition:()=>true}
  };

  class TourManager {
    constructor() {
      this.app = $("#appContent");
      this.modal = $("#modalBackdrop");
      this.user = null;
      this.role = "";
      this.allowed = new Set();
      this.progress = this.emptyProgress();
      this.snapshot = {request:null,order:null,warranties:null};
      this.mode = "closed";
      this.node = null;
      this.readyBadge = false;
      this.syncTimer = null;
      this.renderTimer = null;
      this.scrollTimer = null;
      this.syncSequence = 0;
      this.refreshing = false;
      this.error = "";
      this.lastWaitingNode = "";
      this.lastNodeId = "";
      this.launcher = null;
      this.bubble = null;
      this.shades = [];
      this.ring = null;
      this.lastScrollTarget = null;
    }

    emptyProgress() { return {tour:TOUR_ID,entityType:null,entityId:null,requestId:null,orderId:null,quoteId:null,quoteChoice:null,agendaSeen:false,node:null,lastVerified:null,status:"READY",updatedAt:Date.now()}; }
    userKey() { return `seprigua_tour_active_v${VERSION}:${this.user.usuario_id}:${TOUR_ID}`; }
    entityKey() { return `seprigua_tour_v${VERSION}:${this.user.usuario_id}:${TOUR_ID}:${this.progress.entityType}:${this.progress.entityId}`; }
    save() {
      this.progress.updatedAt = Date.now();
      try {
        const raw = JSON.stringify(this.progress);
        localStorage.setItem(this.userKey(), raw);
        if (this.progress.entityId) localStorage.setItem(this.entityKey(), raw);
      } catch (_) { /* Continúa sin persistencia si el navegador la bloquea. */ }
    }
    load() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.userKey()) || "null");
        if (saved?.tour !== TOUR_ID) return;
        this.progress = {...this.emptyProgress(), requestId:numberId(saved.requestId),orderId:numberId(saved.orderId),quoteId:numberId(saved.quoteId),quoteChoice:["yes","no"].includes(saved.quoteChoice)?saved.quoteChoice:null,agendaSeen:saved.agendaSeen===true,node:String(saved.node||"")||null,lastVerified:String(saved.lastVerified||"")||null,status:String(saved.status||"READY"),updatedAt:Number(saved.updatedAt)||Date.now()};
        this.bindEntity(false);
      } catch (_) { this.progress = this.emptyProgress(); }
    }
    bindEntity(save=true) {
      if (this.progress.orderId) { this.progress.entityType = "OrdenTrabajo"; this.progress.entityId = this.progress.orderId; }
      else if (this.progress.requestId) { this.progress.entityType = "SolicitudServicio"; this.progress.entityId = this.progress.requestId; }
      else { this.progress.entityType = null; this.progress.entityId = null; }
      if (save) this.save();
    }
    view() { return window.SEPRIGUATourContext?.() || {}; }
    module() { return this.view().module || this.app.dataset.renderedModule || document.body.dataset.module || "dashboard"; }
    orderOpen() { return !!$(".order-workspace") && numberId(this.view().orderId) === this.progress.orderId; }
    requestModal() { return !this.modal?.hidden && new RegExp(`^Solicitud\\s*#${this.progress.requestId}\\b`,"i").test($("#modalTitle")?.textContent.trim() || ""); }
    activeCrew() { return (this.snapshot.order?.tecnicos || []).filter(person => ["ASIGNADO","CONFIRMADO"].includes(upper(person.estado || person.Estado))); }
    quote() { return (this.snapshot.order?.cotizaciones || []).find(item => numberId(item.id) === this.progress.quoteId) || (this.snapshot.order?.cotizaciones || [])[0] || null; }
    context() {
      const request = this.snapshot.request?.item || null;
      const detail = this.snapshot.order;
      const order = detail?.item || null;
      const progress = detail?.progress || {};
      const rules = detail?.reglas_cierre || {};
      const quote = this.quote();
      const warranty=(this.snapshot.warranties?.items||[]).find(item=>numberId(item.orden_id)===this.progress.orderId)||null;
      const code = upper(order?.estado_codigo);
      const pendingReprogram = (detail?.reprogramaciones || []).some(item => upper(item.estado)==="PENDIENTE");
      const pendingScopes = (detail?.cambios_alcance || []).filter(item => upper(item.estado)==="PENDIENTE");
      const hasNumber = !!String(order?.orden_papel || "").trim();
      const hasFile = Number(progress.documentos_ot || 0) > 0;
      const documentReady = (!rules.ticket_obligatorio || !!String(order?.ticket || "").trim()) && (hasNumber === hasFile);
      const minPhotos = Math.max(0,Number(rules.min_fotos ?? 1));
      return {role:this.role,module:this.module(),requestId:this.progress.requestId,orderId:this.progress.orderId,quoteId:numberId(quote?.id)||this.progress.quoteId,request,order,orderCode:code,orderOpen:this.orderOpen(),requestModal:this.requestModal(),orderStep:this.view().orderStep || "resumen",quote,quoteCode:upper(quote?.estado || quote?.Estado),quoteChoice:this.progress.quoteChoice,warranty,warrantyCode:upper(warranty?.estado_garantia),hasCrew:this.activeCrew().length>0,pendingReprogram,scopePending:pendingScopes.length>0,serverScopePending:Number(progress.cambios_pendientes||0)>0,scopeUnsent:pendingScopes.some(item=>!item.informado_por),documentReady,photosReady:Number(progress.fotos_trabajo||0)>=minPhotos,descriptionReady:Number(progress.actividades||0)>0,firstRequestId:numberId($('#appContent [data-action="ver-solicitud"]')?.dataset.id),crewFormReady:all('#crewForm .crew-check:checked').length>0 && all('#crewForm .crew-check:checked').filter(input=>$('#crewForm .crew-function[data-id="'+CSS.escape(input.value)+'"]')?.value==="ENCARGADO").length===1};
    }

    async getJson(path) {
      const response = await fetch(path,{credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json"}});
      if (!response.ok) throw new Error(response.status===401?"La sesión terminó.":response.status===403?"No tienes acceso a este registro.":"No se pudo actualizar este registro.");
      const data = await response.json();
      if (data.ok===false) throw new Error(data.message || "No se pudo consultar el registro.");
      return data;
    }
    scheduleSync(delay=180) {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => this.sync(), delay);
    }
    async sync() {
      if (!this.user || this.refreshing) { if (this.refreshing) this.scheduleSync(500); return; }
      this.refreshing = true;
      const sequence = ++this.syncSequence;
      const requestId = this.progress.requestId;
      const orderId = this.progress.orderId;
      try {
        const [request,order,warranties] = await Promise.all([
          requestId && this.role!=="TECNICO" ? this.getJson(`/api/solicitudes/${requestId}`) : Promise.resolve(null),
          orderId ? this.getJson(`/api/ordenes/${orderId}`) : Promise.resolve(null),
          orderId && this.role==="COORDINADOR" && this.allowed.has("garantia") ? this.getJson("/api/garantias").catch(()=>null) : Promise.resolve(null)
        ]);
        if (sequence!==this.syncSequence) return;
        this.error="";
        if (request) this.snapshot.request=request;
        if (order) this.snapshot.order=order;
        if (warranties) this.snapshot.warranties=warranties;
        const linkedOrder = numberId(request?.item?.orden_id);
        if (linkedOrder && linkedOrder!==this.progress.orderId) { this.progress.orderId=linkedOrder; this.snapshot.order=null; this.bindEntity(); this.scheduleSync(40); }
        const linkedRequest = numberId(order?.item?.solicitud_id);
        if (linkedRequest && !this.progress.requestId) { this.progress.requestId=linkedRequest; this.bindEntity(); }
        const quoteId = numberId((order?.cotizaciones || [])[0]?.id);
        if (quoteId && quoteId!==this.progress.quoteId) { this.progress.quoteId=quoteId; this.save(); }
        this.update();
      } catch (error) { this.error=error.message; this.render(); }
      finally { this.refreshing=false; }
    }

    record(type,id,requestId=null) {
      const value=numberId(id);
      if (!value || this.mode==="closed") return;
      if (["solicitud","solicitud-creada"].includes(type) && !this.progress.requestId && !this.progress.orderId) {this.progress.requestId=value;this.snapshot.request=null;}
      if (["orden","orden-creada"].includes(type) && !this.progress.orderId) {
        this.progress.orderId=value;
        this.snapshot.order=null;
        if (!this.progress.requestId && numberId(requestId)) this.progress.requestId=numberId(requestId);
      }
      this.bindEntity();
      this.scheduleSync(60);
      this.scheduleRender();
    }
    adoptCurrentRecord(force=false) {
      const visibleOrder = numberId(this.view().orderId);
      if ($( ".order-workspace") && visibleOrder && (force || !this.progress.orderId)) {
        if(this.progress.orderId!==visibleOrder){this.snapshot={request:null,order:null,warranties:null};this.progress.quoteChoice=null;this.progress.agendaSeen=false;}
        this.progress.orderId=visibleOrder;
        if(force)this.progress.requestId=null;
      }
      const modalId = /^Solicitud\s*#(\d+)/i.exec(!this.modal?.hidden ? $("#modalTitle")?.textContent || "" : "")?.[1];
      if (modalId && (force || (!this.progress.requestId && !this.progress.orderId))) {
        if(this.progress.requestId!==numberId(modalId))this.snapshot={request:null,order:null,warranties:null};
        this.progress.requestId=numberId(modalId);
        if(force)this.progress.orderId=null;
      }
      this.bindEntity();
    }

    requestField() {
      const form = $("#requestForm");
      if (!form) return null;
      const fields = [
        ["#requestClient","Selecciona el cliente","Elige el cliente que solicita el servicio."],
        ["#requestLocation","Selecciona la sede","Indica la ubicación que necesita atención."],
        ["#requestType","Selecciona el servicio","Elige el tipo de servicio para clasificar el trabajo."],
        ["#requestClass","Clasifica la solicitud","Indica si la solicitud es programada o emergencia."],
        ["#requestUrgency","Indica la urgencia","En una emergencia, selecciona el nivel de urgencia real."],
        ['#requestForm [name="fecha_preferida"]',"Indica la fecha preferida","En una solicitud programada, registra la fecha y hora solicitadas."],
        ['#requestForm [name="descripcion"]',"Describe el problema","Explica el servicio requerido para que coordinación pueda revisarlo."]
      ];
      for (const [selector,title,text] of fields) {
        const field=$(selector);
        if (!field || field.disabled) continue;
        if (selector.includes('fecha_preferida') && $("#requestClass")?.value!=="PROGRAMADA") continue;
        if (!String(field.value || "").trim()) return {fieldTarget:selector,fieldTitle:title,fieldText:text,fieldReady:false};
      }
      return null;
    }

    // El nodo se calcula desde datos frescos. No se acepta un índice guardado como prueba.
    chooseNode() {
      const c=this.context();
      if (this.error) return {id:"error",actor:"SISTEMA",action:"ACTION_WAIT",title:"No se pudo comprobar el avance",text:this.error,target:null};
      const coreModules=this.role==="TECNICO"?["ordenes"]:["solicitudes","ordenes"];
      if(coreModules.some(module=>!this.allowed.has(module)))return {id:"noPermission",actor:"SISTEMA",action:"ACTION_INFO",title:"Flujo no disponible para esta cuenta",text:"Esta cuenta no tiene acceso a todos los módulos necesarios para el flujo principal. Usa la ayuda contextual de los módulos que sí aparecen en tu menú.",target:null};
      if ($( "#requestForm") && !c.orderId && this.role!=="TECNICO") {
        const field=this.requestField();
        return field ? {...FLOW.requestField,id:"requestField",title:field.fieldTitle,text:field.fieldText,target:()=>field.fieldTarget,completionCondition:()=>!!$(field.fieldTarget)?.value.trim()} : {...FLOW.requestSave,id:"requestSave"};
      }
      if ($( "#orderForm") && this.role==="COORDINADOR") return {...FLOW.orderForm,id:"orderForm"};
      if ($( "#crewForm") && this.role==="COORDINADOR") return c.crewFormReady ? {...FLOW.crewSave,id:"crewSave"} : {...FLOW.crewChoose,id:"crewChoose"};
      if ($( "#warrantyConfigForm") && this.role==="COORDINADOR") return $('#warrantyConfigForm [name="dias"]')?.value ? {...FLOW.saveWarranty,id:"saveWarranty"} : {...FLOW.warrantyDays,id:"warrantyDays"};
      if ($( "#quoteFullForm") && this.role==="COORDINADOR") return {...FLOW.saveQuote,id:"saveQuote"};
      if ($( "#decideRescheduleForm") && this.role==="COORDINADOR") return {...FLOW.saveReprogram,id:"saveReprogram"};
      if ($( "#scopeResponse") && this.role==="CLIENTE") return {...FLOW.saveScope,id:"saveScope"};
      if ($( "#quoteResponse") && this.role==="CLIENTE") return $('#quoteResponse [name="respuesta"]')?.value ? {...FLOW.clientQuoteSave,id:"clientQuoteSave"} : {...FLOW.clientQuoteChoice,id:"clientQuoteChoice"};
      if ($( "#suspendOrderForm") && this.role==="TECNICO") return {id:"suspendOrder",actor:"TECNICO",action:"ACTION_STATE_CHANGE",stage:8,title:"Solicita reprogramación",text:"Registra el motivo, trabajo realizado, pendientes, nueva fecha y fotos. Coordinación deberá decidir después.",target:()=> '#suspendOrderForm button[type="submit"]'};

      if (!c.requestId && !c.orderId) {
        const targetModule=this.role==="TECNICO"?"ordenes":"solicitudes";
        if(c.module!==targetModule) return {...FLOW[targetModule==="ordenes"?"navOrders":"navRequests"],id:targetModule==="ordenes"?"navOrders":"navRequests"};
        if(targetModule==="ordenes") return {...FLOW.openOrder,id:"openOrder"};
        return c.firstRequestId ? {...FLOW.chooseRequest,id:"chooseRequest"} : {...FLOW.newRequest,id:"newRequest"};
      }
      if (c.requestId && !c.orderId && this.role!=="TECNICO") {
        if(!c.request) return {id:"checkingRequest",actor:"SISTEMA",action:"ACTION_WAIT",title:"Comprobando solicitud",text:"Consultando su estado actual antes de señalar la siguiente acción.",target:null};
        if(upper(c.request.Estado)==="CANCELADA") return {...FLOW.cancelled,id:"cancelled"};
        if(this.role==="CLIENTE") return {id:"waitOrder",...FLOW.waitCoordinator,title:"Esperando la orden",text:`La solicitud #${c.requestId} está registrada. Coordinación revisará si corresponde crear una OT; el tour se reanudará cuando exista.`};
        if(c.module!=="solicitudes" && !c.requestModal) return {...FLOW.navRequests,id:"navRequests"};
        if(!c.requestModal) return $(`#appContent [data-action="ver-solicitud"][data-id="${c.requestId}"]`) ? {...FLOW.chooseRequest,id:"chooseRequest"} : {...FLOW.requestSearch,id:"requestSearch"};
        return {...FLOW.createOrder,id:"createOrder"};
      }
      if (!c.order) return {id:"checkingOrder",actor:"SISTEMA",action:"ACTION_WAIT",title:"Comprobando orden",text:"Consultando el estado actual de la OT antes de continuar.",target:null};
      if(c.orderCode==="CANCELADA") return {...FLOW.cancelled,id:"cancelled",text:"La OT fue cancelada. Este servicio ya no continúa por el flujo de ejecución."};
      if(c.orderCode==="COMPLETADA" && this.role==="TECNICO")return {...FLOW.complete,id:"complete"};

      if (this.role==="CLIENTE") {
        if(c.serverScopePending && !c.scopePending)return {id:"waitScopeCoordinator",...FLOW.waitCoordinator,title:"Esperando a Coordinación",text:"Hay un cambio de alcance pendiente que todavía no se ha comunicado a tu cuenta. Coordinación debe continuar primero."};
        if(c.scopePending && !c.scopeUnsent) {
          if(!c.orderOpen) return this.orderAccessNode(c);
          return {...FLOW.respondScope,id:"respondScope"};
        }
        if(c.quoteCode==="ENVIADA" && this.allowed.has("cotizaciones")) {
          if(c.module!=="cotizaciones") return {...FLOW.navQuotes,id:"navQuotes"};
          if(!$(".quote-flow-hero")) return {...FLOW.quoteDetail,id:"quoteDetail"};
          return {...FLOW.clientQuoteResponse,id:"clientQuoteResponse"};
        }
        if(c.orderCode==="COMPLETADA")return {...FLOW.complete,id:"complete"};
        return {id:"waitService",...FLOW.waitTechnicianFinish,title:"Esperando la atención",text:"La OT está en seguimiento. El personal asignado registrará la ejecución y el cierre; volveremos a comprobar su estado."};
      }

      if (this.role==="COORDINADOR") {
        if(c.orderCode==="COMPLETADA") {
          if(c.quoteCode==="ENVIADA")return {...FLOW.waitClient,id:"waitClient",title:"Esperando respuesta a la cotización",text:"La OT terminó, pero la cotización enviada sigue esperando la respuesta del cliente."};
          if(c.warrantyCode==="PENDIENTE_CONFIGURACION") {
            if(c.module!=="garantia")return {...FLOW.navWarranty,id:"navWarranty"};
            return {...FLOW.configureWarranty,id:"configureWarranty"};
          }
          return {...FLOW.complete,id:"complete"};
        }
        if(!c.hasCrew) {
          if(!c.orderOpen) return this.orderAccessNode(c);
          return {...FLOW.openCrew,id:"openCrew"};
        }
        if(c.pendingReprogram) {
          if(!c.orderOpen) return this.orderAccessNode(c);
          return {...FLOW.decideReprogram,id:"decideReprogram"};
        }
        if(c.scopeUnsent) {
          if(!c.orderOpen) return this.orderAccessNode(c);
          return {...FLOW.sendScope,id:"sendScope"};
        }
        if(c.scopePending) return {...FLOW.waitClient,id:"waitClient",title:"Esperando respuesta del cliente",text:"El cambio de alcance fue informado. El cliente debe responder antes de cerrar la OT."};
        if(c.quote && this.progress.quoteChoice!=="no" && this.allowed.has("cotizaciones")) {
          if(["BORRADOR","CONFIRMADA","OBSERVADA"].includes(c.quoteCode)) {
            if(c.module!=="cotizaciones" && !$('#modalBackdrop:not([hidden]) [data-action="enviar-cotizacion"]')) return {...FLOW.navQuotes,id:"navQuotes"};
            return {...FLOW.sendQuote,id:"sendQuote"};
          }
          if(c.quoteCode==="ENVIADA") return {...FLOW.waitClient,id:"waitClient",title:"Esperando respuesta a la cotización",text:"La propuesta está enviada. El cliente puede aceptarla, solicitar cambios o rechazarla; volveremos a comprobar el estado."};
          if(["CAMBIOS","RECHAZADA"].includes(c.quoteCode)) {
            if(c.module!=="cotizaciones") return {...FLOW.navQuotes,id:"navQuotes"};
            if(!$('#modalBackdrop:not([hidden]) [data-action="version-cotizacion"]')) return {...FLOW.quoteDetail,id:"quoteDetail"};
            return {...FLOW.reviseQuote,id:"reviseQuote"};
          }
        }
        if(!c.quote && this.progress.quoteChoice===null && this.allowed.has("cotizaciones")) return {...FLOW.choiceQuote,id:"choiceQuote"};
        if(!c.quote && this.progress.quoteChoice==="yes") {
          if(!c.orderOpen) return this.orderAccessNode(c);
          return {...FLOW.openQuote,id:"openQuote"};
        }
        if(c.order.programada && !this.progress.agendaSeen) {
          if(c.module==="agenda") { this.progress.agendaSeen=true; this.save(); }
          else return {...FLOW.navAgenda,id:"navAgenda"};
        }
        return ["EN_PROCESO","POR_CONFIRMAR"].includes(c.orderCode)?{...FLOW.waitTechnicianFinish,id:"waitTechnicianFinish"}:{...FLOW.waitTechnicianStart,id:"waitTechnicianStart"};
      }

      if (this.role==="TECNICO") {
        if(c.pendingReprogram) return {...FLOW.waitCoordinator,id:"waitCoordinator",title:"Esperando la reprogramación",text:"Esta OT está suspendida. Coordinación debe aprobar o rechazar la fecha propuesta antes de reanudar."};
        if(c.scopePending) return {...FLOW.waitClient,id:"waitClient",title:"Esperando cambio de alcance",text:"El cambio detectado debe resolverse por Coordinación y, cuando corresponda, por el cliente antes del cierre."};
        if(!c.orderOpen) return this.orderAccessNode(c);
        if(["PENDIENTE","PROGRAMADA"].includes(c.orderCode)) return {...FLOW.startOrder,id:"startOrder"};
        if(!["EN_PROCESO","POR_CONFIRMAR"].includes(c.orderCode)) return {...FLOW.waitCoordinator,id:"waitCoordinator",title:"Revisa el estado de la OT",text:"La orden está en un estado que no permite continuar el cierre técnico desde esta pantalla."};
        if(!c.documentReady) return c.orderStep==="documento" ? {...FLOW.saveDocument,id:"saveDocument"} : {...FLOW.tabDocument,id:"tabDocument"};
        if(!c.photosReady) {
          if(c.orderStep!=="evidencia") return {...FLOW.tabEvidence,id:"tabEvidence"};
          return $('#orderEvidenceForm [name="archivos"]')?.files?.length ? {...FLOW.evidenceSave,id:"evidenceSave"} : {...FLOW.evidenceFile,id:"evidenceFile"};
        }
        if(!c.descriptionReady) {
          if(c.orderStep!=="descripcion") return {...FLOW.tabDescription,id:"tabDescription"};
          return $('#orderDescriptionForm [name="descripcion"]')?.value.trim() ? {...FLOW.descriptionSave,id:"descriptionSave"} : {...FLOW.descriptionField,id:"descriptionField"};
        }
        return c.orderStep==="finalizar" ? {...FLOW.finishOrder,id:"finishOrder"} : {...FLOW.tabFinish,id:"tabFinish"};
      }
      return {...FLOW.complete,id:"complete"};
    }
    orderAccessNode(c) {
      if(c.module!=="ordenes" && !c.orderOpen) return {...FLOW.navOrders,id:"navOrders"};
      if($('.order-workspace') && !c.orderOpen) return {id:"leaveOtherOrder",actor:this.role,action:"ACTION_CLICK",stage:4,title:"Vuelve a la lista de órdenes",text:"Hay otra OT abierta. Regresa a la lista para buscar el servicio de este recorrido.",target:()=> '.order-workspace [data-action="volver-ordenes"], .order-workspace [data-action="volver-agenda"]'};
      return $(`#appContent [data-action="ver-orden"][data-id="${c.orderId}"]`) ? {...FLOW.openOrder,id:"openOrder"} : {...FLOW.orderSearch,id:"orderSearch"};
    }

    update() {
      const next=this.chooseNode();
      if (!next) return;
      const changed=next.id!==this.lastNodeId;
      if (changed) {
        if(this.node?.completionCondition && this.node.completionCondition(this.context()))this.progress.lastVerified=this.node.id;
        if (this.lastWaitingNode && next.id!==this.lastWaitingNode) this.readyBadge=true;
        this.lastWaitingNode=next.action==="ACTION_WAIT"?next.id:"";
        this.lastNodeId=next.id;
        this.progress.node=next.id;
        this.progress.status=next.id==="complete"?"COMPLETED":next.action==="ACTION_WAIT"?"WAITING_FOR_ACTOR":"READY";
        this.save();
        this.lastScrollTarget=null;
      }
      this.node=next;
      this.render();
    }
    scheduleRender(delay=70) {
      clearTimeout(this.renderTimer);
      this.renderTimer=setTimeout(()=>this.update(),delay);
    }
    mount() {
      this.launcher=document.createElement("button");
      this.launcher.id="seTourLauncher";
      this.launcher.type="button";
      this.launcher.className="se-tour-launcher";
      this.launcher.setAttribute("aria-label","Abrir ayuda SEPRIGUA");
      this.launcher.setAttribute("aria-controls","seTourBubble");
      this.launcher.innerHTML='<span aria-hidden="true">?</span><span class="se-tour-ready-badge" hidden></span>';
      this.bubble=document.createElement("section");
      this.bubble.id="seTourBubble";
      this.bubble.className="se-tour-bubble";
      this.bubble.setAttribute("aria-label","Ayuda operativa SEPRIGUA");
      this.bubble.hidden=true;
      this.ring=document.createElement("div");
      this.ring.className="se-tour-spotlight";
      this.ring.hidden=true;
      for(let i=0;i<4;i++) {
        const shade=document.createElement("div");
        shade.className="se-tour-shade";
        shade.hidden=true;
        shade.setAttribute("aria-hidden","true");
        shade.addEventListener("click",event=>event.preventDefault());
        this.shades.push(shade);
      }
      document.body.append(...this.shades,this.ring,this.launcher,this.bubble);
      this.launcher.addEventListener("click",()=>this.mode==="closed"?this.openMenu():this.close());
      this.bubble.addEventListener("click",event=>this.onHelpClick(event));
      document.addEventListener("keydown",event=>{if(event.key==="Escape" && this.mode!=="closed")this.close();});
      document.addEventListener("click",event=>{if(this.mode==="guided" && !event.target.closest?.("#seTourBubble,#seTourLauncher"))this.scheduleRender(110);});
      document.addEventListener("toggle",event=>{if(this.mode==="guided" && event.target.matches?.("details"))this.scheduleRender(110);},true);
      document.addEventListener("input",event=>{if(event.target.closest?.("#requestForm,#orderForm,#crewForm,#orderEvidenceForm,#orderDescriptionForm,#quoteResponse,#quoteFullForm,#warrantyConfigForm"))this.scheduleRender(90);});
      document.addEventListener("change",event=>{if(event.target.closest?.("#requestForm,#orderForm,#crewForm,#orderEvidenceForm,#orderDescriptionForm,#quoteResponse,#quoteFullForm,#warrantyConfigForm"))this.scheduleRender(90);});
      document.addEventListener("seprigua:tour-record",event=>this.record(event.detail?.type,event.detail?.id,event.detail?.solicitudId));
      document.addEventListener("seprigua:tour-change",event=>{
        if (!this.progress.entityId || !/^\/api\/(ordenes|solicitudes|cotizaciones|garantias)/.test(event.detail?.path||"")) return;
        this.scheduleSync(250);
      });
      window.addEventListener("resize",()=>this.place(),{passive:true});
      document.addEventListener("scroll",()=>this.place(),{capture:true,passive:true});
      document.addEventListener("visibilitychange",()=>{if(!document.hidden && this.progress.entityId)this.scheduleSync(80);});
      window.addEventListener("focus",()=>{if(this.progress.entityId)this.scheduleSync(80);});
      const observer=new MutationObserver(()=>this.scheduleRender(90));
      observer.observe(this.app,{childList:true,subtree:true,attributes:true,attributeFilter:["data-rendered-module"]});
      if(this.modal) observer.observe(this.modal,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"]});
      this.poller=window.setInterval(()=>{
        if(!document.hidden && this.progress.entityId && this.progress.status==="WAITING_FOR_ACTOR")this.sync();
      },POLL_MS);
      this.update();
    }
    openMenu() {
      this.mode="menu";
      this.render();
      if(this.progress.entityId)this.scheduleSync(40);
    }
    start(contextual=false) {
      this.mode="guided";
      this.readyBadge=false;
      if(contextual || (!this.progress.requestId && !this.progress.orderId))this.adoptCurrentRecord(contextual);
      this.update();
      if(this.progress.entityId)this.scheduleSync(40);
    }
    close() {
      this.mode="closed";
      this.save();
      this.hideSpotlight();
      this.bubble.hidden=true;
      this.launcher.setAttribute("aria-expanded","false");
      this.launcher.focus({preventScroll:true});
    }
    reset() {
      this.progress=this.emptyProgress();
      this.snapshot={request:null,order:null,warranties:null};
      this.error="";
      this.lastWaitingNode="";
      this.lastNodeId="";
      this.readyBadge=false;
      this.save();
      this.start(false);
    }
    onHelpClick(event) {
      const action=event.target.closest("[data-tour-action]")?.dataset.tourAction;
      if(!action)return;
      event.preventDefault();
      if(action==="close")return this.close();
      if(action==="menu")return this.openMenu();
      if(action==="start")return this.start();
      if(action==="context")return this.start(true);
      if(action==="overview") { this.mode="overview"; return this.render(); }
      if(action==="catalog") { this.mode="catalog"; return this.render(); }
      if(action==="reset")return this.reset();
      if(action==="quote-yes"||action==="quote-no") {
        this.progress.quoteChoice=action==="quote-yes"?"yes":"no";
        this.save();
        return this.update();
      }
      if(action==="new-flow")return this.reset();
      if(action==="retry")return this.sync();
    }
    hideSpotlight() { this.ring.hidden=true; this.shades.forEach(element=>element.hidden=true); }
    isShown(element) {
      if(!element || !element.isConnected || !element.getClientRects().length)return false;
      const style=getComputedStyle(element);
      return style.display!=="none" && style.visibility!=="hidden";
    }
    targetFor(spec) {
      const c=this.context();
      const selector=typeof spec.target==="function"?spec.target(c):spec.target;
      if(!selector)return null;
      let element=null;
      try { element=all(selector).find(item=>this.isShown(item)) || null; } catch(_) { return null; }
      const modalOpen=this.modal && !this.modal.hidden;
      if(modalOpen && element && !this.modal.contains(element)) {
        const close=$("#modalClose");
        if(this.isShown(close))return {element:close,intermediate:"Cierra esta ventana para continuar con el control señalado."};
      }
      if(element && element.closest("#systemNav")) {
        const rect=element.getBoundingClientRect();
        if(rect.right<=0 || rect.left>=innerWidth) {
          const menu=$("#menuButton");
          if(this.isShown(menu))return {element:menu,intermediate:"Abre el menú y después selecciona el módulo señalado."};
        }
      }
      if(!element && c.orderOpen && spec.target && !["tabDocument","tabEvidence","tabDescription","tabFinish"].includes(spec.id)) {
        const summary=$('.order-workspace .order-workspace-toolbar [data-action="orden-paso"]');
        if(this.isShown(summary))return {element:summary,intermediate:"Vuelve al resumen de la OT para encontrar esta acción."};
      }
      return element?{element,intermediate:null}:null;
    }
    placeSpotlight(element) {
      let rect=element.getBoundingClientRect();
      if(rect.bottom<20 || rect.top>innerHeight-20 || rect.right<0 || rect.left>innerWidth) {
        if(this.lastScrollTarget!==element) {
          this.lastScrollTarget=element;
          element.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"center",inline:"nearest"});
          clearTimeout(this.scrollTimer);
          this.scrollTimer=setTimeout(()=>this.place(),310);
        }
        this.hideSpotlight();
        return false;
      }
      const pad=5, x=Math.max(3,rect.left-pad), y=Math.max(3,rect.top-pad);
      const w=Math.min(innerWidth-x-3,rect.width+pad*2), h=Math.min(innerHeight-y-3,rect.height+pad*2);
      if(w<3 || h<3){this.hideSpotlight();return false;}
      Object.assign(this.ring.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});
      const [top,left,right,bottom]=this.shades;
      Object.assign(top.style,{left:"0px",top:"0px",width:`${innerWidth}px`,height:`${y}px`});
      Object.assign(left.style,{left:"0px",top:`${y}px`,width:`${x}px`,height:`${h}px`});
      Object.assign(right.style,{left:`${x+w}px`,top:`${y}px`,width:`${Math.max(0,innerWidth-x-w)}px`,height:`${h}px`});
      Object.assign(bottom.style,{left:"0px",top:`${y+h}px`,width:`${innerWidth}px`,height:`${Math.max(0,innerHeight-y-h)}px`});
      this.shades.forEach(shade=>shade.hidden=false);
      this.ring.hidden=false;
      return {x,y,w,h};
    }
    placeBubble(rect) {
      this.bubble.classList.toggle("is-anchored",!!rect);
      this.bubble.classList.remove("arrow-top","arrow-bottom");
      this.bubble.style.left="";this.bubble.style.top="";this.bubble.style.right="";this.bubble.style.bottom="";
      if(!rect) {
        this.bubble.style.right="18px";
        this.bubble.style.bottom="84px";
        return;
      }
      const width=this.bubble.offsetWidth;
      const height=this.bubble.offsetHeight;
      const left=Math.max(10,Math.min(innerWidth-width-10,rect.x+rect.w/2-width/2));
      let top=rect.y+rect.h+15;
      let direction="arrow-top";
      if(top+height>innerHeight-12 && rect.y-height-15>=8) {top=rect.y-height-15;direction="arrow-bottom";}
      else if(top+height>innerHeight-12)top=Math.max(8,innerHeight-height-12);
      this.bubble.classList.add(direction);
      this.bubble.style.left=`${left}px`;
      this.bubble.style.top=`${top}px`;
      const arrow=Math.max(18,Math.min(width-18,rect.x+rect.w/2-left));
      this.bubble.style.setProperty("--tour-arrow-left",`${arrow}px`);
    }
    place() {
      if(this.mode!=="guided" || !this.node || !this.node.target)return;
      const target=this.targetFor(this.node);
      if(!target){this.hideSpotlight();this.placeBubble(null);return;}
      const rect=this.placeSpotlight(target.element);
      this.placeBubble(rect || null);
    }
    closeButton() {return '<button class="se-tour-close" type="button" data-tour-action="close" aria-label="Cerrar tutorial" title="Cerrar tutorial">×</button>';}
    renderMenu() {
      const c=this.context();
      const entity=this.progress.orderId?`OT #${this.progress.orderId}`:this.progress.requestId?`Solicitud #${this.progress.requestId}`:"Nuevo proceso";
      const pending=this.node?.action==="ACTION_WAIT"?` · ${this.node.title}`:this.node?.title?` · ${this.node.title}`:"";
      return `<header class="se-tour-menu-head"><div><small>AYUDA SEPRIGUA</small><strong>Tu guía operativa</strong></div>${this.closeButton()}</header><div class="se-tour-menu-body">
        ${this.readyBadge?'<div class="se-tour-new-step">Hay un nuevo paso disponible.</div>':''}
        <button type="button" data-tour-action="start" class="se-tour-menu-option"><strong>Continuar flujo guiado</strong><span>${escapeHtml(entity+pending)}</span></button>
        <button type="button" data-tour-action="context" class="se-tour-menu-option"><strong>¿Qué debo hacer ahora?</strong><span>${escapeHtml(moduleLabels[c.module]||c.module)}</span></button>
        <button type="button" data-tour-action="overview" class="se-tour-menu-option"><strong>Ver flujo completo</strong></button>
        <button type="button" data-tour-action="catalog" class="se-tour-menu-option"><strong>Tutoriales disponibles</strong></button>
        <button type="button" data-tour-action="reset" class="se-tour-menu-reset">Reiniciar tutorial</button>
      </div>`;
    }
    renderOverview() {
      const rows=["Solicitud y revisión","Orden de trabajo","Asignación y agenda","Ejecución y evidencias","Cotización cuando aplica","Reprogramación o cambios si surgen","Cierre y notificaciones"];
      return `<header class="se-tour-menu-head"><div><small>FLUJO PRINCIPAL</small><strong>Mapa del proceso</strong></div>${this.closeButton()}</header><div class="se-tour-menu-body"><p class="se-tour-note">Las ramas dependen de los estados reales del servicio y del rol conectado.</p><ol class="se-tour-overview">${rows.map(text=>`<li>${escapeHtml(text)}</li>`).join("")}</ol><button type="button" data-tour-action="start" class="se-tour-primary">Continuar flujo guiado</button><button type="button" data-tour-action="menu" class="se-tour-menu-reset">Volver</button></div>`;
    }
    renderCatalog() {
      return `<header class="se-tour-menu-head"><div><small>TUTORIALES</small><strong>Disponibles</strong></div>${this.closeButton()}</header><div class="se-tour-menu-body"><button type="button" data-tour-action="start" class="se-tour-menu-option"><strong>Flujo principal de atención</strong><span>Guía operativa entre los módulos y actores reales.</span></button><p class="se-tour-note">Los recorridos especializados se incorporarán después de completar este flujo principal.</p><button type="button" data-tour-action="menu" class="se-tour-menu-reset">Volver</button></div>`;
    }
    renderGuided() {
      const spec=this.node || this.chooseNode();
      const c=this.context();
      const title=typeof spec.title==="function"?spec.title(c):spec.title;
      const description=typeof spec.text==="function"?spec.text(c):spec.text;
      const waiting=spec.action==="ACTION_WAIT";
      const noTarget=!spec.target;
      const target=!noTarget?this.targetFor(spec):null;
      const smallNote=target?.intermediate || (!noTarget && !target ? "Este control no está visible todavía. Abre el registro o ajusta los filtros; la guía lo señalará cuando aparezca." : "");
      this.bubble.className=`se-tour-bubble se-tour-tooltip${waiting?" is-waiting":""}${spec.id==="complete"?" is-complete":""}`;
      this.bubble.innerHTML=`<div class="se-tour-tooltip-head"><span>${waiting?"ESPERA ENTRE USUARIOS":spec.id==="complete"?"FLUJO REAL COMPLETADO":`ETAPA ${spec.stage||1} · ${escapeHtml(Array.isArray(spec.actor)?this.role:spec.actor||this.role)}`}</span>${this.closeButton()}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>
        ${smallNote?`<div class="se-tour-detail">${escapeHtml(smallNote)}</div>`:""}
        ${spec.id==="choiceQuote"?'<div class="se-tour-choice"><button type="button" data-tour-action="quote-yes">Sí, gestionar cotización</button><button type="button" data-tour-action="quote-no">No aplica a esta OT</button></div>':""}
        ${spec.id==="complete"||spec.id==="cancelled"?'<button type="button" data-tour-action="new-flow" class="se-tour-primary">Iniciar otro proceso</button>':""}
        ${spec.id==="error"?'<button type="button" data-tour-action="retry" class="se-tour-primary">Reintentar consulta</button>':""}
        ${waiting?'<div class="se-tour-wait-line"><span></span>Comprobando el registro periódicamente</div>':!noTarget?'<div class="se-tour-verify-line">Avanza al comprobar la acción real</div>':""}`;
      this.bubble.hidden=false;
      if(target) {
        const rect=this.placeSpotlight(target.element);
        this.placeBubble(rect || null);
      } else {this.hideSpotlight();this.placeBubble(null);}
    }
    render() {
      if(!this.launcher)return;
      this.launcher.setAttribute("aria-expanded",String(this.mode!=="closed"));
      $(".se-tour-ready-badge")?.toggleAttribute("hidden",!this.readyBadge);
      if(this.mode==="closed"){this.bubble.hidden=true;this.hideSpotlight();return;}
      if(this.mode==="guided")return this.renderGuided();
      this.hideSpotlight();
      this.bubble.className="se-tour-bubble se-tour-menu";
      this.bubble.innerHTML=this.mode==="overview"?this.renderOverview():this.mode==="catalog"?this.renderCatalog():this.renderMenu();
      this.bubble.hidden=false;
      this.placeBubble(null);
    }
    async init() {
      if(!this.app)return;
      try {
        const session=await this.getJson("/api/auth/me");
        const user=session.user;
        if(!numberId(user?.usuario_id) || !["COORDINADOR","TECNICO","CLIENTE"].includes(upper(user?.rol)))return;
        this.user=user;
        this.role=upper(user.rol);
        this.allowed=new Set(Array.isArray(user.modulos)?user.modulos:[]);
        this.load();
        this.mount();
        if(this.progress.entityId)this.scheduleSync(40);
      } catch(_) { /* Sin sesión autenticada, no se muestra el botón. */ }
    }
  }

  new TourManager().init();
})();
