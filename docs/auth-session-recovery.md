# Recuperação da sessão e do perfil

Revisão de 7 de outubro de 2026 após o relato da tela **Não foi possível verificar seu acesso**.

A consulta do perfil pode receber HTTP 401 quando o token de acesso armazenado é rejeitado. O app anteriormente mostrava o erro sem renovar essa sessão. Além disso, um novo login ou uma renovação para o mesmo usuário era ignorado pelo carregamento de perfil, mesmo quando a consulta anterior havia falhado.

O carregamento agora renova a sessão uma única vez ao receber 401 e repete as consultas de perfil e de permissão administrativa. A nova sessão deve pertencer ao mesmo usuário. Se a renovação falhar ou a consulta continuar rejeitada, o acesso permanece indisponível e o botão de tentar novamente continua disponível.

Uma consulta que falhou também pode ser retomada após `SIGNED_IN` ou `TOKEN_REFRESHED` na mesma conta. Consultas já bem-sucedidas não são repetidas por notificações duplicadas. As consultas continuam começando fora do callback de autenticação do SDK. Ao reconectar, o perfil é revalidado, inclusive quando havia sido carregado do cache offline.

Respostas tardias são descartadas após logout, troca de conta ou desmontagem do provider. Uma negativa HTTP 403 não provoca renovação nem é substituída por permissões em cache. Falhas na consulta administrativa não promovem o usuário a administrador.

Diagnóstico do servidor foi feito com leituras: disponibilidade de autenticação e REST, preflight CORS, presença dos perfis, acesso às próprias linhas via RLS e consistência das chaves de autenticação entre os serviços. Nenhuma política, chave, conta ou registro financeiro foi alterado.

As regressões usam backend fictício e cobrem 401 recuperável e persistente, novo login, renovação na mesma conta, reconexão, revogação de administrador, logout e troca de usuário durante a renovação.
