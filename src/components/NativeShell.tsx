import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/contexts/ThemeContext";
import {
  aplicarTemaNativo,
  isNativeApp,
  ouvirBotaoVoltar,
  ouvirRetomada,
  sairDoAppNativo,
} from "@/lib/native";

/**
 * Comportamentos do app nativo que dependem do router e do cache de consultas.
 *
 * Fica dentro do `BrowserRouter` e do provedor de consultas de propósito: é de
 * lá que saem o histórico de navegação e a invalidação do cache. No navegador
 * todos os ganchos abaixo retornam sem registrar nada.
 */
const NativeShell = () => {
  const queryClient = useQueryClient();
  const { theme } = useTheme();

  // Botão físico de voltar do Android.
  useEffect(() => {
    if (!isNativeApp()) return;

    const voltar = (podeVoltar: boolean) => {
      // 1. Modal aberto fecha primeiro. Sem isto, voltar com um modal de
      //    pagamento na tela navegava por baixo dele e o modal ficava órfão.
      //    Radix e o menu "Mais" já escutam Escape no `document`.
      const modalAberto = document.querySelector('[role="dialog"],[role="alertdialog"]');
      if (modalAberto) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      // 2. Tem para onde voltar dentro do app. Quem responde isso é a própria
      //    WebView, e é só nela que se pode confiar: um palpite a partir de
      //    `history.length` erra para mais, e aí `history.back()` não faz nada
      //    — o botão voltar simplesmente para de responder e não há como sair
      //    do app. Sair de uma tela funda por engano se recupera reabrindo;
      //    ficar preso, não.
      if (podeVoltar) {
        window.history.back();
        return;
      }
      // 3. Raiz do app: aí sim sair é o esperado no Android.
      void sairDoAppNativo();
    };

    let descartar: (() => void) | undefined;
    let cancelado = false;
    void ouvirBotaoVoltar(voltar).then((remover) => {
      if (cancelado) remover();
      else descartar = remover;
    });
    return () => {
      cancelado = true;
      descartar?.();
    };
  }, []);

  // Volta do segundo plano: recarrega o que estava em cache.
  useEffect(() => {
    if (!isNativeApp()) return;

    let descartar: (() => void) | undefined;
    let cancelado = false;
    void ouvirRetomada(() => {
      void queryClient.invalidateQueries();
    }).then((remover) => {
      if (cancelado) remover();
      else descartar = remover;
    });
    return () => {
      cancelado = true;
      descartar?.();
    };
  }, [queryClient]);

  // Status bar acompanha o tema escolhido na hora em que ele muda.
  useEffect(() => {
    void aplicarTemaNativo(theme);
  }, [theme]);

  return null;
};

export default NativeShell;
