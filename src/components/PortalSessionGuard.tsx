import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isClientPortalActive, isPortalRoute,endCreditorSessionForPortal } from "@/lib/portalSession";

/**
 * Guarda global: se existir sessão do portal do cliente no navegador,
 * qualquer tentativa de navegar para rotas do app do credor é bloqueada
 * e o usuário é devolvido ao portal. Também faz signOut de qualquer sessão
 * Supabase que porventura exista no mesmo navegador (não pode coexistir).
 */
export const PortalSessionGuard = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isClientPortalActive()) return;

    // Garante que não haja sessão de credor coexistindo
    void endCreditorSessionForPortal();

    if (!isPortalRoute(location.pathname)) {
      navigate("/portal-cliente", { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
};

export default PortalSessionGuard;
