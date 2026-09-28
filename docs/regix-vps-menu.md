# Regix — Hermes e serviços da VPS

Registro da configuração aplicada no Regix Core em 28/09/2026.

## Menu inicial

O menu inicial deve identificar o Regix Core e indicar que o Hermes Agent está disponível, com os botões:

- 📚 Mangás/Light Novel
- 🤖 Abrir Hermes Agent
- 🖥️ Status da VPS
- 🔗 Serviços da VPS

## Serviço publicado

- Nome: Hermes Agent
- URL: https://hermes-agent.j8amca.easypanel.host

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
