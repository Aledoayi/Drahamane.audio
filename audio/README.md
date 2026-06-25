# Dossier audio

Placez les fichiers audio dans ce dossier.

Formats pris en charge :

- MP3
- M4A
- AAC
- WAV
- OGG/OGA
- FLAC
- WebM audio

Après l’ajout ou la suppression de fichiers, exécutez à la racine du projet :

```bash
node sync-manifest.js
```

La lecture via un serveur local peut aussi détecter automatiquement les fichiers
si le serveur expose la liste du dossier.
