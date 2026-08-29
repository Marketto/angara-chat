# Proposte per il suono di notifica

Tre prototipi originali, sintetizzati e non derivati da registrazioni di terzi:

1. `khomus-di-ghiaccio.wav` — attacco secco, armonici metallici e coda cristallina.
2. `arco-della-taiga.wav` — due note ascendenti dal carattere morbido e arcuato.
3. `eco-del-baikal.wav` — impulso grave seguito da un tintinnio simile al ghiaccio.

La terza proposta, **Eco del Baikal**, è quella selezionata per Angara. L'asset
usato dall'app si trova in `apps/web/public/sounds/eco-del-baikal.wav`.

Sono bozze per scegliere l'identità sonora, non campionamenti autentici degli
strumenti tradizionali citati come ispirazione.

Rigenerazione e verifica:

```bash
node docs/prototypes/notification-sounds/generate.mjs
node docs/prototypes/notification-sounds/validate.mjs
```

Il browser o il sistema operativo decide il suono delle notifiche Web Push in
background. Il campione scelto può essere riprodotto quando Angara è già aperta
e conservato come asset per una futura integrazione nativa.
