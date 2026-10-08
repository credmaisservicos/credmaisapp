import {expect,it} from 'vitest';
import {parseClassificationAmount,classificationInputSchema,parseClassificationResult,classificationRpcArgs,type ClassificationDraft} from '@/lib/paymentClassification';
it.each([['0',0],['0,00',0],['80,10',80.1],['1234.56',1234.56],['1.234,56',1234.56],['1000000000000',1e12]])('interpreta valor monetário explícito %s', (input,result)=>expect(parseClassificationAmount(input)).toBe(result));
it.each(['','-1','NaN','Infinity','1e2','1,234','1.234','1.23,45','1000000000001','1,2,3','0.001'])('recusa valor ambíguo ou inválido %s',input=>expect(parseClassificationAmount(input)).toBeNull());
const draft:ClassificationDraft={id:'11111111-1111-4111-8111-111111111111',ownerId:'22222222-2222-4222-8222-222222222222',input:{installmentId:'33333333-3333-4333-8333-333333333333',transactionId:'44444444-4444-4444-8444-444444444444',version:'c'.repeat(32),principal:80,interest:15,fees:5,reason:'Conferência humana do extrato',evidence:'Extrato fictício TESTE-001',confirmed:true}};
it('preserva a identidade do pedido e exige confirmação do resultado correspondente',()=>{
 expect(classificationInputSchema.parse(draft.input)).toEqual(draft.input);
 expect(classificationRpcArgs(draft)).toMatchObject({_request_id:draft.id,_expected_owner:draft.ownerId,_principal:80});
 expect(parseClassificationResult({ok:true,request_id:draft.id,replayed:true},draft)).toEqual({applied:true});
 expect(parseClassificationResult({ok:true,request_id:draft.id,cancelled:true},draft,true)).toEqual({applied:false});
 expect(()=>parseClassificationResult({ok:true,request_id:draft.ownerId,replayed:false},draft)).toThrow('classification_response_mismatch');
 expect(()=>parseClassificationResult({ok:true,request_id:draft.id},draft)).toThrow('classification_response_mismatch');
});
