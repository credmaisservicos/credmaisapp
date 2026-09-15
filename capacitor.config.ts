import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.credmais.app',
  appName: 'CredMais',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      // Quem tira o splash é o app, em `iniciarShellNativo()`, assim que o React
      // monta. Antes eram 0ms: o splash saía antes do bundle carregar e sobrava
      // uma tela vazia no lugar. Este tempo é só o teto de segurança para o caso
      // de o bundle não carregar — aí a tela não fica presa no splash.
      launchShowDuration: 6000,
      launchAutoHide: true,
      backgroundColor: '#08111d',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
    },
    StatusBar: {
      style: 'DARK',
      overlaysWebView: false,
      backgroundColor: '#08111d',
    },
  },
};

export default config;
