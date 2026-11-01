# Anime Tier List

Webový tier list, který se přes Firebase synchronizuje mezi zařízeními a z rozšíření
Seriálový Switcher si bere oblíbené ze Světa seriálů s plakátem a názvem.

- Nové oblíbené se objeví v přihrádce **Nezařazené**, do tieru je přetáhneš ručně.
- Export do JSON a PNG, import z JSON.
- Export pro AI: Markdown jen s tiery a názvy, stáhne se a zkopíruje do schránky.
- Zkušební režim bez přihlášení a bez synchronizace: přidej k adrese `?demo`.

## Nastavení Firebase (projekt `svtextension`)

1. Firestore: pravidla ze souboru `firestore.rules`.
2. Authentication: zapnutý poskytovatel Google.
3. Authentication → Settings → Authorized domains: `waterdrag.github.io`.

## Spuštění

Stačí statický server, například `npx http-server -p 4173`.
