import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Sparkles, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const NegotiationTab = ({ clientId, sessionToken }: { clientId: string, sessionToken: string }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Olá! Sou o assistente de negociação. Identifiquei algumas pendências em seu nome. Como posso ajudar você a regularizar sua situação hoje?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-negotiation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: newMessages.slice(-10), // Enviar apenas as últimas 10 para economizar tokens
          clientId,
          session_token: sessionToken,
        }),
      });

      if (!response.ok) throw new Error("Erro ao falar com o assistente");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Sem corpo de resposta");

      let assistantMessage = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content || "";
              assistantMessage += content;
              
              setMessages(prev => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                updated[updated.length - 1].content = assistantMessage;
                return updated;
              });
            } catch (e) {
              // Algumas linhas podem não ser JSON válido se o chunk for cortado
            }
          } else if (line.trim() && !line.startsWith("data: ")) {
            // Suporte a stream direto de texto se não for formato SSE
            assistantMessage += line;
            setMessages(prev => {
              if (prev.length === 0) return prev;
              const updated = [...prev];
              updated[updated.length - 1].content = assistantMessage;
              return updated;
            });
          }
        }
      }
    } catch (err) {
      toast({
        title: "Erro",
        description: "Não foi possível processar sua mensagem. Tente novamente.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[500px] bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border bg-primary/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Assistente de Negociação</h3>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Online agora</span>
            </div>
          </div>
        </div>
        <Sparkles size={16} className="text-primary/40" />
      </div>

      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`flex gap-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center border ${
                  msg.role === "user" ? "bg-primary/10 border-primary/20" : "bg-accent border-border"
                }`}>
                  {msg.role === "user" ? <User size={14} className="text-primary" /> : <Bot size={14} className="text-primary" />}
                </div>
                <div className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground rounded-tr-none" 
                    : "bg-muted text-foreground rounded-tl-none"
                }`}>
                  {msg.content || (isLoading && i === messages.length - 1 ? <Loader2 size={16} className="animate-spin" /> : null)}
                </div>
              </div>
            </div>
          ))}
          {isLoading && messages.at(-1)?.role === "user" && (
            <div className="flex justify-start">
              <div className="flex gap-2 items-center text-muted-foreground">
                <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center animate-pulse">
                  <Bot size={14} />
                </div>
                <span className="text-xs italic">Digitando...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border bg-accent/30">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex gap-2"
        >
          <Input
            name="negotiation_message"
            aria-label="Mensagem da negociação"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua proposta ou dúvida..."
            className="flex-1 rounded-xl bg-card border-border"
            disabled={isLoading}
          />
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            className="rounded-xl px-3"
          >
            <Send size={18} />
          </Button>
        </form>
        <p className="text-[9px] text-center text-muted-foreground mt-3 flex items-center justify-center gap-1 uppercase tracking-tighter">
          <MessageSquare size={10} /> Negociação assistida por Inteligência Artificial
        </p>
      </div>
    </div>
  );
};
