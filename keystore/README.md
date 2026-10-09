# Ключ подписи (не в git)

Сюда кладутся `polka-release.jks` и `keystore.properties` — оба игнорируются git.
Обновления ставятся поверх установленного приложения только с тем же ключом — храни бэкап.

`keystore.properties`:
```
storeFile=../../keystore/polka-release.jks
storePassword=...
keyAlias=polka
keyPassword=...
```
Новый ключ: `keytool -genkeypair -keystore keystore/polka-release.jks -alias polka -keyalg RSA -keysize 4096 -validity 10000`
