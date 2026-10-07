export type DocumentReview = {
  document_type:string; label:string; readable:boolean; complete:boolean;
  quality:'good'|'acceptable'|'poor'; authenticity_risk:'low'|'medium'|'high';
  decision:'accepted'|'resend'|'manual_review'; reasons:string[];
};

export const DOCUMENT_LABELS:Record<string,string>={
  selfie_id:'selfie segurando RG ou CNH',identity_front:'documento de identificação — frente',
  identity_back:'documento de identificação — verso',address_proof:'comprovante de endereço',
  bank_statement:'extrato bancário',cnpj_card:'cartão CNPJ',work_card:'carteira de trabalho',
  payslip:'contracheque',vehicle_document:'documento do veículo',rental_contract:'documento da locadora',
  app_profile:'perfil no aplicativo',app_income:'faturamento no aplicativo',business_proof:'comprovante do comércio',
  unknown:'arquivo não identificado',
};

export function requiredDocumentTypes(profile:string):string[]{
  const common=['selfie_id','identity_front','identity_back','address_proof','bank_statement'];
  if(profile==='clt')return [...common,'work_card'];
  if(profile==='cnpj')return [...common,'cnpj_card'];
  if(profile==='motorista_app')return [...common,'vehicle_document','app_profile','app_income'];
  if(profile==='comercio_app')return [...common,'business_proof','app_profile','app_income'];
  return common;
}

export function allowedDocumentTypes(profile:string):string[]{
  return [...requiredDocumentTypes(profile),...(profile==='clt'?['payslip']:profile==='motorista_app'?['rental_contract']:[])];
}

/** Visual triage is conservative and never grants credit or legal authenticity. */
export function normalizeDocumentReview(parsed:any,profile:string):DocumentReview{
  const type=typeof parsed?.document_type==='string'&&Object.hasOwn(DOCUMENT_LABELS,parsed.document_type)?parsed.document_type:'unknown';
  const review:DocumentReview={document_type:type,label:DOCUMENT_LABELS[type],readable:parsed?.readable===true,complete:parsed?.complete===true,
    quality:['good','acceptable','poor'].includes(parsed?.quality)?parsed.quality:'poor',
    authenticity_risk:['low','medium','high'].includes(parsed?.authenticity_risk)?parsed.authenticity_risk:'medium',
    decision:['accepted','resend','manual_review'].includes(parsed?.decision)?parsed.decision:'manual_review',
    reasons:Array.isArray(parsed?.reasons)?parsed.reasons.filter((reason:unknown)=>typeof reason==='string').map((reason:string)=>reason.slice(0,180)).slice(0,4):[]};
  let reason='';
  if(review.authenticity_risk==='high'||(review.decision==='accepted'&&review.authenticity_risk!=='low')){
    review.decision='manual_review';reason='O arquivo precisa de conferência humana';
  }else if(review.decision==='accepted'){
    if(type==='unknown'){review.decision='manual_review';reason='Não foi possível identificar o documento';}
    else if(!allowedDocumentTypes(profile).includes(type)){review.decision='resend';reason='Este arquivo não substitui um dos documentos solicitados';}
    else if(!review.readable||!review.complete||review.quality==='poor'){review.decision='resend';reason='O documento está ilegível, incompleto ou com baixa qualidade';}
  }
  if(reason)review.reasons=[reason,...review.reasons].slice(0,4);
  return review;
}

export function documentProgress(profile:string,previous:unknown,review?:DocumentReview){
  const required=requiredDocumentTypes(profile);
  const received=[...new Set((Array.isArray(previous)?previous:[]).filter((type:unknown)=>typeof type==='string'&&required.includes(type)))];
  if(review?.decision==='accepted'&&required.includes(review.document_type)&&!received.includes(review.document_type))received.push(review.document_type);
  const missing=required.filter(type=>!received.includes(type));
  return {received,missing,completed:missing.length===0};
}

export function documentHelp(text:string){
  const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  return /^(?:ajuda|opcoes|documentos)[.!?\s]*$/.test(t)
    || /(?:quais?|o que|oq).*(?:falta|pendente)|(?:falta|pendente).*(?:documento|enviar)|lista.*documento|ja (?:enviei|mandei).*(?:tudo|documento)/.test(t);
}

export function isPaymentReceiptCaption(text:string){
  const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/paguei|transferi/.test(t))return true;
  return /comprovante/.test(t)&&(/pagamento|pix|parcela/.test(t)||!/endereco|residencia|renda|locadora|negocio/.test(t));
}

export function documentHelpReply(profile:string,received:unknown){
  const {missing}=documentProgress(profile,received);
  return missing.length?`Ainda falta enviar:\n\n${missing.map(type=>`• ${DOCUMENT_LABELS[type]}`).join('\n')}\n\nEnvie um arquivo por vez, legível e sem cortes. A equipe faz a conferência final. Escreva “atendente” se precisar de ajuda.`
    :'Os documentos solicitados já constam na triagem. A equipe fará a conferência final; isso não significa aprovação do empréstimo.';
}
