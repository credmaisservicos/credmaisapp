import { describe,expect,it } from 'vitest';
import { BOT_DEFAULTS,loadBotSettings,validateBotSettings,botSettingsChanges } from '@/lib/botSettings';
describe('configurações do agente e cobranças',()=>{
  it('preserva campos existentes e mantém segredos fora do formulário',()=>{
    const form=loadBotSettings({bot_auto_send:true,bot_send_minute:7,bot_tone:'casual',whatsapp_api_key:'private'});
    expect(form.bot_auto_send).toBe(true);expect(form.bot_send_minute).toBe(7);expect(form.bot_tone).toBe('casual');expect(form).not.toHaveProperty('whatsapp_api_key');
  });
  it('salva apenas alterações do módulo',()=>{expect(botSettingsChanges({...BOT_DEFAULTS,bot_retry_interval_hours:72},BOT_DEFAULTS)).toEqual({bot_retry_interval_hours:72});});
  it.each([0,501,NaN])('recusa limite diário inválido %s',value=>{expect(validateBotSettings({...BOT_DEFAULTS,bot_max_messages_per_day:value})).not.toBeNull();});
  it('aceita lembrete antes do vencimento e ambos os canais',()=>{expect(validateBotSettings({...BOT_DEFAULTS,bot_escalation_rules:[{days:-3,template:'lembrete',channel:'both'}]})).toBeNull();});
  it('recusa SMS indisponível e etapas duplicadas',()=>{
    expect(validateBotSettings({...BOT_DEFAULTS,bot_escalation_rules:[{days:1,template:'',channel:'sms'}]})).not.toBeNull();
    expect(validateBotSettings({...BOT_DEFAULTS,bot_escalation_rules:[{days:1,template:'',channel:'email'},{days:1,template:'',channel:'whatsapp'}]})).not.toBeNull();
  });
  it('avisa quando a agenda impediria todas as cobranças',()=>{expect(validateBotSettings({...BOT_DEFAULTS,bot_enabled:true,bot_business_hours_only:true,bot_send_hour:23})).toContain('dentro do expediente');});
  it('aceita expediente noturno',()=>{expect(validateBotSettings({...BOT_DEFAULTS,bot_enabled:true,bot_business_hours_only:true,bot_business_start:'22:00',bot_business_end:'06:00',bot_send_hour:23})).toBeNull();});
});
