PACOTE DE DEMONSTRAÇÃO — HORIZONTE DE CUIDADO
============================================

Arquivos nesta pasta:

- HorizonteDeCuidado_1.0.0.0_x64.msix
- HorizonteDeCuidado-dev.cer

SHA-256 do MSIX:
6B23A0196FDC1CB50CC4453C7DDFB483AD914663F3C9BFB21BB5B16326173BFA

O .msix é assinado com certificado de teste. O .cer é o certificado público
correspondente. A Microsoft Store reassina o pacote em produção.

Instalação local:
1. Confie no certificado público .cer (pode exigir administrador).
2. Abra o .msix.
3. Se a política da instituição bloquear sideload, use Intune/GPO ou a Store.

O pacote inclui o cliente OAuth Desktop do projeto. O backup no Google Drive
é opcional, usa a conta do próprio usuário e o escopo mínimo drive.appdata.
O JSON do cliente não é versionado no código-fonte; em aplicativo instalado, o
segredo do cliente Desktop não é confidencial e o fluxo usa PKCE. As funções
locais continuam disponíveis sem login.

A demonstração web fica em ../app/ e usa apenas dados fictícios. Ela não
acessa o Google Drive.

Nunca publique dados reais de pacientes neste repositório.
