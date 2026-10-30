PACOTE DE DEMONSTRAÇÃO — HORIZONTE DE CUIDADO
============================================

Arquivos nesta pasta:

- HorizonteDeCuidado_1.0.0.0_x64.msix
- HorizonteDeCuidado-dev.cer

SHA-256 do MSIX:
DE45BB04A5F05D29C89075D39C75A2E5845EA5995798A1686ED54DED831FBBD8

O .msix é assinado com certificado de teste. O .cer é o certificado público
correspondente. A Microsoft Store reassina o pacote em produção.

Instalação local:
1. Abra o PowerShell como administrador e confie no certificado na loja da
   máquina (a loja do usuário não basta para o AppX):

   Import-Certificate -FilePath .\HorizonteDeCuidado-dev.cer `
     -CertStoreLocation Cert:\LocalMachine\TrustedPeople

2. Abra o .msix.
3. Se a política da instituição bloquear sideload, use Intune/GPO ou a Store.

Sem o passo 1, o Windows pode recusar o pacote com o erro 0x800B0109
("o certificado raiz da assinatura deve ser confiável").

O pacote inclui o cliente OAuth Desktop do projeto. O backup no Google Drive
é opcional, usa a conta do próprio usuário e o escopo mínimo drive.appdata.
O JSON do cliente não é versionado no código-fonte; em aplicativo instalado, o
segredo do cliente Desktop não é confidencial e o fluxo usa PKCE. As funções
locais continuam disponíveis sem login.

A demonstração web fica em ../app/ e usa apenas dados fictícios. Ela não
acessa o Google Drive.

A versão Android está em preparação para o Google Play, com o pacote
horizonte.de.cuidado. O login usa o Google Sign-In nativo; nenhum segredo de
cliente vai no APK/AAB.

Nunca publique dados reais de pacientes neste repositório.
