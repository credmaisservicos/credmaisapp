import { useState } from "react";
import { Database, Search, Building2, User, MapPin, Phone, Mail, Users, AlertCircle, Loader2, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { isValidCNPJ, isValidCPF } from "@/lib/cpfCnpj";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const PuxadaDados = () => {
  const { toast } = useToast();
  const [documento, setDocumento] = useState("");
  const [tipo, setTipo] = useState<"cpf" | "cnpj">("cpf");
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [erro, setErro] = useState("");

  const handleSearch = async () => {
    if (loading) return;
    const clean = documento.replace(/\D/g, "");
    const valid = tipo === "cpf" ? isValidCPF(clean) : isValidCNPJ(clean);
    if (!valid) {
      setResultado(null);
      setErro("");
      toast({ title: "Documento inválido", description: `Informe um ${tipo.toUpperCase()} válido.`, variant: "destructive" });
      return;
    }

    setLoading(true);
    setErro("");
    setResultado(null);

    const { data, error } = await supabase.functions.invoke("consulta-dados", {
      body: { tipo, documento: clean },
    });

    setLoading(false);

    if (error || data?.error) {
      setErro(data?.error || error?.message || "Erro na consulta");
      return;
    }

    setResultado(data);
  };

  const formatDoc = (value: string) => {
    const clean = value.replace(/\D/g, "");
    if (tipo === "cpf") {
      return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) =>
        d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
      );
    }
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, (_, a, b, c, d, e) =>
      e ? `${a}.${b}.${c}/${d}-${e}` : d ? `${a}.${b}.${c}/${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
    );
  };

  const inputCls = "w-full px-4 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring";

  return (
    <div className="space-y-6">
      <div className="page-hero animate-fade-in">
        <div className="page-hero-content flex items-center gap-3">
          <div className="page-hero-icon">
            <Database size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-shimmer">Puxada de Dados</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Consulte informações de CPF e CNPJ via API Brasil</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4 max-w-xl">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setTipo("cpf"); setDocumento(""); setResultado(null); setErro(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tipo === "cpf" ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}
          >
            CPF
          </button>
          <button
            type="button"
            onClick={() => { setTipo("cnpj"); setDocumento(""); setResultado(null); setErro(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tipo === "cnpj" ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}
          >
            CNPJ
          </button>
        </div>

        <div>
          <label htmlFor="document-search" className="text-xs font-medium text-muted-foreground mb-1 block">{tipo.toUpperCase()}</label>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <input
              id="document-search"
              name="document_search"
              aria-label={`Consultar ${tipo.toUpperCase()}`}
              value={documento}
              onChange={(e) => { setDocumento(formatDoc(e.target.value)); setErro(""); setResultado(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={tipo === "cpf" ? "000.000.000-00" : "00.000.000/0001-00"}
              maxLength={tipo === "cpf" ? 14 : 18}
              className={inputCls}
            />
            <button
              type="button"
              aria-label={`Buscar ${tipo.toUpperCase()}`}
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2.5 rounded-lg text-primary-foreground text-sm font-semibold disabled:opacity-50 shrink-0"
              style={{ background: "var(--gradient-button, hsl(var(--primary)))" }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {erro && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-500">{erro}</p>
        </div>
      )}

      {/* Results */}
      {resultado && resultado.tipo === "cnpj" && resultado.dados && (
        <div className="space-y-4">
          {/* Header */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 size={24} className="text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-foreground">{resultado.dados.razao_social}</h2>
                {resultado.dados.nome_fantasia && (
                  <p className="text-sm text-muted-foreground">{resultado.dados.nome_fantasia}</p>
                )}
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline" className={resultado.dados.situacao_cadastral === "ATIVA" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"}>
                    {resultado.dados.situacao_cadastral}
                  </Badge>
                  {resultado.dados.porte && <Badge variant="outline">{resultado.dados.porte}</Badge>}
                </div>
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard title="Dados Cadastrais" icon={<Building2 size={16} />} items={[
              { label: "CNPJ", value: resultado.dados.cnpj },
              { label: "Natureza Jurídica", value: resultado.dados.natureza_juridica },
              { label: "CNAE", value: `${resultado.dados.cnae_fiscal} - ${resultado.dados.cnae_descricao}` },
              { label: "Início Atividade", value: resultado.dados.data_inicio_atividade },
            ]} />

            <InfoCard title="Endereço" icon={<MapPin size={16} />} items={[
              { label: "Logradouro", value: `${resultado.dados.logradouro}, ${resultado.dados.numero}` },
              { label: "Complemento", value: resultado.dados.complemento },
              { label: "Bairro", value: resultado.dados.bairro },
              { label: "Cidade/UF", value: `${resultado.dados.municipio}/${resultado.dados.uf}` },
              { label: "CEP", value: resultado.dados.cep },
            ]} />

            <InfoCard title="Contato" icon={<Phone size={16} />} items={[
              { label: "Telefone", value: resultado.dados.telefone },
              { label: "E-mail", value: resultado.dados.email },
            ]} />

            <InfoCard title="Financeiro" icon={<DollarSign size={16} />} items={[
              { label: "Capital Social", value: safeNumber(resultado.dados.capital_social) > 0 ? `R$ ${safeNumber(resultado.dados.capital_social).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null },
            ]} />
          </div>

          {/* Partners */}
          {resultado.dados.socios && resultado.dados.socios.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                <Users size={16} /> Quadro Societário
              </h3>
              <div className="divide-y divide-border">
                {resultado.dados.socios.map((s: any, i: number) => (
                  <div key={i} className="flex flex-col gap-1 py-2.5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.nome}</p>
                      <p className="text-xs text-muted-foreground">{s.qualificacao}</p>
                    </div>
                    {s.cpf_cnpj && <span className="break-all text-xs text-muted-foreground font-mono">{s.cpf_cnpj}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {resultado && resultado.tipo === "cpf" && resultado.dados && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <User size={24} className="text-primary" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">Consulta CPF</h2>
                <p className="text-sm font-mono text-muted-foreground">{resultado.dados.cpf || resultado.documento}</p>
              </div>

              {resultado.dados.nome && (
                <div>
                  <p className="text-xs text-muted-foreground">Nome</p>
                  <p className="text-sm font-medium text-foreground">{resultado.dados.nome}</p>
                </div>
              )}

              {resultado.dados.nascimento && (
                <div>
                  <p className="text-xs text-muted-foreground">Nascimento</p>
                  <p className="text-sm text-foreground">{resultado.dados.nascimento}</p>
                </div>
              )}

              {resultado.dados.situacao && (
                <Badge variant="outline" className={resultado.dados.situacao === "Regular" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"}>
                  {resultado.dados.situacao}
                </Badge>
              )}

              {resultado.dados.valido !== undefined && (
                <Badge variant="outline" className={resultado.dados.valido ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"}>
                  {resultado.dados.valido ? "CPF Válido" : "CPF Inválido"}
                </Badge>
              )}

              {resultado.dados.mensagem && (
                <p className="text-xs text-muted-foreground">{resultado.dados.mensagem}</p>
              )}

              {!resultado.api_configurada && (
                <div className="mt-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <p className="text-xs text-amber-600">
                    ⚠️ Para consultas completas de CPF, configure as credenciais da API Brasil nas Configurações (APIBRASIL_BEARER_TOKEN e APIBRASIL_DEVICE_TOKEN).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!resultado && !erro && !loading && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center py-12">
          <Database size={48} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Faça uma consulta para ver os resultados.</p>
          <p className="text-xs text-muted-foreground mt-2">CNPJ: dados completos via BrasilAPI (gratuito) · CPF: requer credenciais API Brasil</p>
        </div>
      )}
    </div>
  );
};

const InfoCard = ({ title, icon, items }: { title: string; icon: React.ReactNode; items: { label: string; value: any }[] }) => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">{icon} {title}</h3>
    <div className="space-y-2">
      {items.filter((i) => i.value).map((item, idx) => (
        <div key={idx}>
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="text-sm text-foreground">{item.value}</p>
        </div>
      ))}
    </div>
  </div>
);

export default PuxadaDados;
