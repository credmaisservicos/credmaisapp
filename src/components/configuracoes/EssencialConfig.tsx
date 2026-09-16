import { Building, Phone, MapPin, Hash } from "lucide-react";
import type { SettingsCtx } from "./types";

const EssencialConfig = ({ ctx }: { ctx: SettingsCtx }) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2 mb-1">
          <Building className="w-5 h-5 text-primary" />
          Dados da Empresa
        </h2>
        <p className="text-sm text-muted-foreground">Informações básicas que aparecem em faturas e recibos.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label htmlFor="essential-company-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Building className="w-3 h-3" /> Nome da Empresa
          </label>
          <input
            id="essential-company-name" name="company_name" autoComplete="organization" value={ctx.form.company_name}
            onChange={(e) => ctx.setForm({ ...ctx.form, company_name: e.target.value })}
            className={ctx.inputCls}
            placeholder="Ex: Minha Empresa LTDA"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="essential-company-cnpj" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Hash className="w-3 h-3" /> CNPJ / CPF
          </label>
          <input
            id="essential-company-cnpj" name="company_cnpj" value={ctx.form.company_cnpj}
            onChange={(e) => ctx.setForm({ ...ctx.form, company_cnpj: e.target.value })}
            className={ctx.inputCls}
            placeholder="00.000.000/0001-00"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="essential-company-phone" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Phone className="w-3 h-3" /> WhatsApp Comercial
          </label>
          <input
            id="essential-company-phone" name="company_phone" autoComplete="tel" value={ctx.form.company_phone}
            onChange={(e) => ctx.setForm({ ...ctx.form, company_phone: e.target.value })}
            className={ctx.inputCls}
            placeholder="+55 (11) 99999-9999"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="essential-company-address" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <MapPin className="w-3 h-3" /> Endereço
          </label>
          <input
            id="essential-company-address" name="company_address" autoComplete="street-address" value={ctx.form.company_address}
            onChange={(e) => ctx.setForm({ ...ctx.form, company_address: e.target.value })}
            className={ctx.inputCls}
            placeholder="Rua, Número, Bairro, Cidade - UF"
          />
        </div>
      </div>
    </div>
  );
};

export default EssencialConfig;
