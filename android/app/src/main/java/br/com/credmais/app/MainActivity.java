package br.com.credmais.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // A partir do Android 15 (targetSdk 35+) o sistema força o layout
        // "de ponta a ponta": a WebView passa a se estender por baixo da barra
        // de status/navegação por padrão, mesmo com StatusBar.overlaysWebView
        // = false no capacitor.config.ts. Sem isto, o topo da tela ficava com
        // uma faixa preta (a área da status bar sem nenhum conteúdo desenhado
        // nela) e a barra de navegação por baixo podia sobrepor a área
        // rolável. Isto restaura o comportamento clássico — a WebView é
        // automaticamente encaixada abaixo da status bar e acima da barra de
        // navegação — que é o que o resto do app (CSS de safe-area, plugin de
        // StatusBar) já assume.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
