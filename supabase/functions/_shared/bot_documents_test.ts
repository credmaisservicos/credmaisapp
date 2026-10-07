import {assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {normalizeDocumentReview,documentProgress,requiredDocumentTypes,documentHelp,isPaymentReceiptCaption} from './bot_documents.ts';
const valid={document_type:'identity_front',readable:true,complete:true,quality:'good',authenticity_risk:'low',decision:'accepted',label:'Empréstimo aprovado'};
Deno.test('document triage accepts compatible readable files without model-provided approval labels',()=>{
 const review=normalizeDocumentReview(valid,'pf');assertEquals(review.decision,'accepted');assertEquals(review.label,'documento de identificação — frente');
});
for(const patch of [{readable:false},{complete:false},{quality:'poor'}])Deno.test(`inconsistent accepted triage requires resending: ${JSON.stringify(patch)}`,()=>{
 assertEquals(normalizeDocumentReview({...valid,...patch},'pf').decision,'resend');
});
for(const risk of ['medium','high'])Deno.test(`accepted visual triage never bypasses human review for ${risk} risk`,()=>{
 assertEquals(normalizeDocumentReview({...valid,authenticity_risk:risk},'pf').decision,'manual_review');
});
Deno.test('unknown, malformed and prototype type values cannot qualify a document',()=>{
 for(const document_type of ['unknown','toString','__proto__',null])assertEquals(normalizeDocumentReview({...valid,document_type},'pf').decision,'manual_review');
 assertEquals(normalizeDocumentReview(null,'pf').decision,'manual_review');
});
Deno.test('wrong-profile document does not substitute a required document',()=>{
 assertEquals(normalizeDocumentReview({...valid,document_type:'cnpj_card'},'pf').decision,'resend');
 assertEquals(normalizeDocumentReview({...valid,document_type:'cnpj_card'},'cnpj').decision,'accepted');
});
Deno.test('optional compatible files are kept without replacing mandatory documents',()=>{
 for(const [profile,type] of [['clt','payslip'],['motorista_app','rental_contract']]){
  const review=normalizeDocumentReview({...valid,document_type:type},profile);assertEquals(review.decision,'accepted');
  assertEquals(documentProgress(profile,[],review).missing,requiredDocumentTypes(profile));
 }
});
Deno.test('pending documents deduplicate received files and ignore unrelated or malformed entries',()=>{
 const review=normalizeDocumentReview(valid,'pf');
 const progress=documentProgress('pf',['identity_front','identity_front',null,'cnpj_card','unknown'],review);
 assertEquals(progress.received,['identity_front']);assertEquals(progress.completed,false);assertEquals(progress.missing.length,4);
});
Deno.test('manual or rejected file never completes the pending requirements',()=>{
 const previous=requiredDocumentTypes('pf').filter(type=>type!=='identity_front');
 for(const decision of ['manual_review','resend'])assertEquals(documentProgress('pf',previous,normalizeDocumentReview({...valid,decision},'pf')).completed,false);
 assertEquals(documentProgress('pf',previous,normalizeDocumentReview(valid,'pf')).completed,true);
});
Deno.test('document assistance understands missing-file and completion questions',()=>{
 for(const text of ['ajuda','quais documentos faltam?','oq falta?','lista de documentos','já enviei tudo'])assertEquals(documentHelp(text),true);
 for(const text of ['PIX parcela 2','atendente','quando vence?'])assertEquals(documentHelp(text),false);
});
Deno.test('registration proofs do not interrupt document collection as payment receipts',()=>{
 for(const text of ['comprovante de endereço','comprovante de renda','comprovante da locadora'])assertEquals(isPaymentReceiptCaption(text),false);
 for(const text of ['comprovante','comprovante PIX parcela 2','paguei parcela 1','transferi para vocês'])assertEquals(isPaymentReceiptCaption(text),true);
});
