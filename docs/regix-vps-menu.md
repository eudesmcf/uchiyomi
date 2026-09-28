# Regix — Hermes e serviços da VPS

Registro da configuração aplicada no Regix Core em 28/09/2026.

## Menu inicial

O menu inicial deve identificar o Regix Core e indicar que o Hermes Agent está disponível, com os botões:

- 📚 Mangás/Light Novel
- 🤖 Abrir Hermes Agent
- 🖥️ Status da VPS
- 🔗 Serviços da VPS

## Serviços publicados

Os atalhos confirmados no Traefik/EasyPanel são:

- Hermes Agent — https://hermes-agent.j8amca.easypanel.host
- Ebook Audio / Kokoro — https://personal-ebook-audio.j8amca.easypanel.host
- MeTube — https://easypanel.clinicamovikids.com.br/metube/
- Obsidian — https://obsidian.clinicamovikids.com.br
- Regix Core — https://personal-regixcore.j8amca.easypanel.host
- UchiYomi — https://manga.clinicamovikids.com.br
- Suwayomi / Room — https://room.clinicamovikids.com.br
- Whisper API — https://personal-whisper-api.j8amca.easypanel.host
- YTD — https://personal-ytd.j8amca.easypanel.host
- n8n — https://n8n.clinicamovikids.com.br
- Excalidraw — https://excalidraw.clinicamovikids.com.br
- Netdata — https://movikids-netdata.j8amca.easypanel.host
- Double Commander — https://movikids-doublecommander.j8amca.easypanel.host
- Evolution API — https://movikids-evolution-api.j8amca.easypanel.host
- Note PGWeb — https://personal-note-pgweb.j8amca.easypanel.host
- Postgres PGWeb — https://personal-postgress-pgweb.j8amca.easypanel.host
- Note DBGate — https://personal-note-dbgate.j8amca.easypanel.host
- Postgres DBGate — https://personal-postgress-dbgate.j8amca.easypanel.host
- Website — https://www.clinicamovikids.com.br
- Aplicação — https://app.clinicamovikids.com.br
- Docs — https://docs.clinicamovikids.com.br
- Painel — https://painel.clinicamovikids.com.br
- EasyPanel — https://easypanel.clinicamovikids.com.br

## Configuração persistente na VPS

- Menu: `/home/ubuntu/regix-config/menus.yaml`
- Bot: `/home/ubuntu/regix-config/bot.py`
- API: `/home/ubuntu/regix-config/api.py`
- Serviço Docker: `personal_regixcore`

O menu é montado no container em `/app/menus.yaml`. Depois de alterar os arquivos persistentes, aplicar:

```bash
docker service update --force personal_regixcore
```

Não registrar tokens, cookies ou senhas neste repositório.
