This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Dados reais

Não há coordenadas ou limites reais de talhão no repositório. O app não inventa polígonos, área, culturas, índices ou alertas. Para conectar uma fazenda:

1. Copie `data/fields.example.json` para `data/fields.json` e preencha cada talhão com seu ID, nome, área cadastral em hectares e geometria GeoJSON `Polygon` ou `MultiPolygon` em longitude/latitude WGS84. Este arquivo é ignorado pelo Git.
2. Crie credenciais OAuth Client Credentials no Sentinel Hub e configure `SENTINEL_HUB_CLIENT_ID` e `SENTINEL_HUB_CLIENT_SECRET` em `.env.local`, baseado em `.env.example`.
3. Reinicie o servidor.

Com o cadastro e as credenciais, `/api/satellite` consulta imagens Sentinel-2 L2A, mascara pixels sem dados, nuvens, sombras, neve e água, calcula NDVI/NDWI/EVI pela Statistical API e retorna a janela anterior para comparação. A média anterior tem a mesma duração da janela escolhida; ela não representa a mesma fase do cultivo sem datas reais de plantio de safras comparáveis.

O clima vem do Open-Meteo para a grade meteorológica mais próxima do centro dos talhões. É dado de modelo/reanálise, não uma estação instalada na fazenda. Sem Sentinel Hub, o clima pode ser exibido à parte, mas nenhum índice ou alerta agronômico é estimado a partir de valores de exemplo.

## Insights automáticos

Configure `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` e `CRON_SECRET` no ambiente do servidor. O modelo padrão é `gemini-2.5-flash`; `GEMINI_MODEL` pode alterá-lo. As chaves nunca são enviadas ao navegador.

O arquivo `vercel.json` agenda `/api/cron/insights` a cada três horas em produção na Vercel. Em desenvolvimento local, o agendador não roda sozinho; é possível testar a rota enviando `Authorization: Bearer <CRON_SECRET>`. O resultado mais recente fica no Upstash por até 30 dias, e o dashboard o consulta sem acionar o Gemini.

O Gemini recebe apenas estatísticas já calculadas, clima e alertas determinísticos. A instrução proíbe atribuir causas que os índices não comprovam; a análise detalhada separa texto da IA, números usados e limitações do sistema. Sem coordenadas reais, Sentinel Hub, Gemini e Upstash configurados, nenhum insight ou dado agrícola é inventado.

## Primeiro acesso

Na primeira abertura, informe o nome e email do responsável, o nome/local da fazenda e a frequência desejada (3, 6, 12 ou 24 horas). O perfil e a frequência são salvos em um único workspace Upstash; isso não cria login nem separa vários usuários. Por isso, mantenha o app atrás da Vercel Deployment Protection.

Se os polígonos GeoJSON não estiverem no servidor, importe o cadastro `fields.json` nessa tela. Ele é validado e salvo no Upstash; não é necessário colocar geometria privada no Git.

A execução usa um único cron Vercel que verifica a frequência salva. O schedule incluído roda a cada 3 horas e exige um plano Vercel que permita essa frequência; o Hobby limita cron a uma execução por dia e não aceita esta configuração. Em desenvolvimento local, o cron não dispara sozinho: acione `/api/cron/insights` manualmente com `Authorization: Bearer <CRON_SECRET>`.
