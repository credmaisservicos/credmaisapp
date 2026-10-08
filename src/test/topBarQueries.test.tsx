import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import TopBar from '@/components/TopBar';
const state=vi.hoisted(()=>({from:vi.fn(),channel:vi.fn(),removeChannel:vi.fn(),mobile:true,owner:'test-owner'}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:state.owner?{id:state.owner}:null,profile:{name:'Teste'},signOut:vi.fn()})}));
vi.mock('@/contexts/ThemeContext',()=>({useTheme:()=>({theme:'dark',toggleTheme:vi.fn()})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('@/hooks/use-mobile',()=>({useIsMobile:()=>state.mobile}));
vi.mock('@/components/NotificationsBell',()=>({default:()=>null}));
vi.mock('@/components/LanguageSwitcher',()=>({default:()=>null}));
vi.mock('@/components/AppModeSwitcher',()=>({default:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:state}));
let client:QueryClient,media:MediaQueryList,listener:()=>void;
beforeEach(()=>{
 state.mobile=true;state.owner='test-owner';state.from.mockReset();state.channel.mockReset();state.removeChannel.mockReset();
 state.from.mockImplementation(()=>{const chain:any={};for(const name of ['select','eq','neq','lt'])chain[name]=()=>chain;chain.range=async()=>({data:[],error:null});return chain;});
 state.channel.mockImplementation(()=>{const channel:any={on:()=>channel,subscribe:()=>channel};return channel;});
 media={matches:false,addEventListener:vi.fn((_event,callback)=>{listener=callback;}),removeEventListener:vi.fn()}as unknown as MediaQueryList;
 vi.stubGlobal('matchMedia',()=>media);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals();});
const ui=()=>render(<QueryClientProvider client={client}><TopBar/></QueryClientProvider>);
it('não consulta indicadores de desktop nem assina suas tabelas no celular',async()=>{
 ui();await act(async()=>{});expect(state.from).not.toHaveBeenCalled();expect(state.channel).not.toHaveBeenCalled();
});
it('também evita consultas quando o desktop é estreito e os indicadores ficam ocultos',async()=>{
 state.mobile=false;ui();await act(async()=>{});expect(state.from).not.toHaveBeenCalled();expect(state.channel).not.toHaveBeenCalled();
});
it('ativa as leituras ao ampliar e para refrescos ao ocultar novamente',async()=>{
 state.mobile=false;ui();Object.defineProperty(media,'matches',{value:true,configurable:true});act(()=>listener());
 await waitFor(()=>expect(state.from).toHaveBeenCalledTimes(3));expect(state.channel).toHaveBeenCalledTimes(1);
 Object.defineProperty(media,'matches',{value:false,configurable:true});act(()=>listener());expect(state.removeChannel).toHaveBeenCalledTimes(1);
 await act(async()=>{await client.invalidateQueries({queryKey:['topbar-financials']});});expect(state.from).toHaveBeenCalledTimes(3);
});
it('tela larga sem sessão não consulta dados financeiros',async()=>{
 state.owner='';Object.defineProperty(media,'matches',{value:true,configurable:true});ui();await act(async()=>{});expect(state.from).not.toHaveBeenCalled();expect(state.channel).not.toHaveBeenCalled();
});
