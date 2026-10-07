# Aplicativo mobile

O CredMais oferece APK assinado no Android e instalação web no iPhone, com
navegação adaptada para toque, safe areas e barra inferior mobile. A página
`/baixar` identifica o aparelho automaticamente. O projeto mantém o shell
Capacitor Android e um projeto iOS nativo opcional.

## Computadores e notebooks

A página `/baixar` oferece "Instalar no computador" para Windows, macOS e Linux.
Quando Chrome ou Edge disponibilizam a janela de instalação, o botão abre essa
janela diretamente. Nos demais casos, o guia acompanha o navegador: menu de
instalação no Chrome/Edge; "Adicionar ao Dock" no Safari do macOS Sonoma 14 ou
mais recente; orientação para abrir no Chrome/Edge em outros navegadores.
O usuário confirma a instalação e abre o CredMais pelo ícone nos aplicativos,
em uma janela própria. Esse app web usa a mesma atualização automática por
deploy e a proteção de formulários já usadas na instalação web do iPhone.

Referências: [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=pt-BR),
[Edge](https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge)
e [Safari no Mac](https://support.apple.com/pt-br/104996).

## Desenvolvimento

```bash
npm ci
npm run mobile:build
```

O comando `mobile:build` gera a aplicação web e sincroniza os arquivos para `android/` e `ios/`.

## Android

A primeira chave release foi criada em 2026-10-07 após confirmação de que os
clientes usavam somente o site. O APK publicado usa `br.com.credmais.app` e a
assinatura pública SHA-256
`02a1bf939703ebc424c406d653a67149d8d8c7699b903285c963a976ced97899`.
A chave privada fica fora do repositório, protegida por ACL no Windows e com
backup em pasta exclusiva do root no VPS. As senhas locais usam DPAPI; no VPS,
a configuração de assinatura tem permissão 600 e não é montada no servidor web.

O download público é
`https://credmaisapp-downloads.fcoipz.easypanel.host/CredMais.apk`.
O endereço `latest.json` no mesmo servidor informa versão, tamanho, SHA-256 e
qual publicação web foi empacotada. APKs anteriores ficam em `/versions/`.

## Atualização automática a cada deploy

O serviço `credmais-mobile-release.timer` no VPS acompanha o site a cada minuto.
O catálogo `web-release.json` identifica cada build e registra os hashes dos
arquivos publicados. O serviço baixa esses arquivos, verifica os hashes,
compila o APK com versionCode maior, confere assinatura/package/debug e só então
substitui o download. Se o site mudar durante a compilação ou houver falha,
mantém o APK anterior e tenta novamente. Publicações antigas sem catálogo usam
o manifesto Vite e os arquivos públicos conhecidos pelo template.

Execute `npm run deploy:cloudflare`: o comando sincroniza o template Android,
publica o web e aguarda o APK correspondente. Deploy pelo painel Cloudflare
também é acompanhado pelo timer. Mudanças no projeto nativo, plugins ou
dependências devem usar esse comando para sincronizar o template no VPS.
Em outro computador, configure o alias SSH `credmais-vps` ou
`CREDMAIS_MOBILE_SSH_HOST`. `--no-template-sync` permite publicar somente mudanças
web quando o template nativo já estiver atualizado; `--preview` valida o site
sem alterar o APK de produção.

O app Android verifica a versão publicada ao abrir e ao retornar ao primeiro
plano (intervalo mínimo de cinco minutos). Quando existe atualização, oferece
o botão "Atualizar aplicativo". O Android pede confirmação da instalação.
A versão web do iPhone continua acompanhando os deploys pelo service worker.
Cada build recebe uma versão própria do service worker. A ativação automática
consulta as abas abertas e aguarda formulários editados, modais e operações
em andamento; os chunks da publicação anterior ficam disponíveis durante essa
transição. Abas anteriores a esse mecanismo adotam a atualização na próxima
navegação ou abertura, evitando interromper uma sessão antiga.

Comandos de operação no VPS:

```bash
systemctl status credmais-mobile-release.timer credmais-mobile-release.service
journalctl -u credmais-mobile-release.service -n 50 --no-pager
systemctl start --no-block credmais-mobile-release.service
```

O log completo do build fica em `/opt/credmais-mobile/last-build.log`. O compilador
Docker usa um núcleo e no máximo 2 GB de memória. O Nginx recebe somente a pasta
pública de APKs; a chave de assinatura não é servida por HTTP. Arquivos e
instruções de instalação estão em `deploy/mobile/`.

## Compilação Android local

Requisitos: Node.js 22.12+, JDK 21, Android SDK 36 e build tools instalados.
Configure `JAVA_HOME` e `ANDROID_HOME` (ou `android/local.properties`).

```bash
npm run mobile:android
```

Para homologação, `npm run mobile:apk` gera `dist-mobile/CredMais-debug.apk`.
O APK de debug não é a versão de entrega aos clientes.

Para gerar o APK assinado que será disponibilizado no site, configure no ambiente:

- `CREDMAIS_ANDROID_KEYSTORE`: caminho absoluto da chave de assinatura existente.
- `CREDMAIS_ANDROID_STORE_PASSWORD`: senha do keystore.
- `CREDMAIS_ANDROID_KEY_ALIAS`: alias da chave.
- `CREDMAIS_ANDROID_KEY_PASSWORD`: senha da chave.
- `CREDMAIS_ANDROID_VERSION_CODE`: inteiro maior que o da última versão distribuída.
- `CREDMAIS_ANDROID_VERSION_NAME`: versão visível, por exemplo `1.0.1`.

Execute `npm run mobile:release`. O resultado é `dist-mobile/CredMais.apk`.
O comando recusa release sem assinatura e versionCode explícitos. Guarde a chave
e suas senhas em armazenamento seguro com backup; elas não entram no Git nem
em variáveis `VITE_*`. Atualizações precisam da **mesma assinatura** do APK que
os clientes já usam. Não gere outra chave antes de verificar essa situação.

Publique o APK assinado em um servidor HTTPS que aceite seu tamanho, com
`Content-Type: application/vnd.android.package-archive` e preferencialmente
`Content-Disposition: attachment; filename="CredMais.apk"`. Use
`Cache-Control: no-cache` se utilizar um nome fixo para novas versões. Configure
`VITE_ANDROID_APK_URL` com essa URL e faça um novo build web. A página `/baixar`
usará esse arquivo no botão Android. O download inicia pelo botão; o usuário precisa
confirmar a instalação no Android. Preserve a versão anterior para rollback e
confira a instalação/atualização em aparelho de homologação antes da publicação.

## iPhone: instalação web

A entrega no iPhone usa o app web pelo Safari e não exige conta Apple Developer
ou compilação nativa. Em `/baixar`, o botão "Instalar no iPhone" mostra:

1. No Safari, toque em Compartilhar.
2. Escolha "Adicionar à Tela de Início"; mantenha "Abrir como App Web" ativado, se aparecer.
3. Confirme em "Adicionar" e abra pelo ícone na tela inicial.

Se o endereço foi aberto pelo WhatsApp, o usuário deve abri-lo no Safari.
O sistema não permite que a página confirme a instalação pelo usuário.

Referência: [instalação web no iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).

## Projeto iOS nativo opcional

Requisitos: macOS com Xcode compatível, conta Apple Developer e assinatura.
O Windows sincroniza os assets, mas não compila nem assina o IPA.

```bash
npm run mobile:ios
```

No Xcode, selecione um simulador ou dispositivo, configure o time de assinatura
e execute o target `App`. Para distribuição, mantenha o bundle ID
`br.com.credmais.app`, incremente o build number e gere um Archive de Release.
Valide e envie para o App Store Connect pelo Organizer do Xcode. Distribua pelo
TestFlight durante a homologação ou submeta à revisão da App Store para entrega.
Essa distribuição nativa é opcional e separada da instalação web oferecida no site.
Referência: [distribuição Apple](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

Sempre que o frontend mudar, rode `npm run mobile:build` antes de abrir o projeto nativo para atualizar os assets embarcados.

## Verificação da entrega

Execute `npm run check` e `npm run test:e2e:local` antes de empacotar. O teste local
usa um backend fictício. Os builds para distribuição usam a configuração pública
correta de produção, mas a homologação financeira deve ser feita em staging com
contas técnicas. Não cadastre, pague ou altere parcelas reais para testar o APK.
