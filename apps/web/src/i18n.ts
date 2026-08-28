import { computed, ref } from 'vue';

export const supportedLocales = ['it', 'en', 'ru'] as const;
export type Locale = typeof supportedLocales[number];

const messages = {
  it: {
    brand: 'Angara', loading: 'Caricamento…', loginEyebrow: 'SOLO TESTO. SOLO PERSONE SCELTE.', loginTitle: 'Una chat piccola, senza rumore.',
    loginText: 'Accedi con Google per scrivere alle persone che conosci. La tua rubrica non viene memorizzata.', install: 'Installa app', installPhone: 'Installa Angara sul telefono',
    keyEyebrow: 'CHIAVE DEL DISPOSITIVO', keyTitle: 'La cifratura è bloccata.', keyText: 'Angara non può recuperare la chiave dal server: è proprio questa separazione a impedire al server di leggere i messaggi.', logout: 'Esci',
    available: 'Disponibile', newChat: 'Nuova chat', notifications: 'Abilita notifiche', conversations: 'Conversazioni', encryptedMessage: 'Messaggio crittografato', startWriting: 'Inizia a scrivere…', empty: 'Nessuna conversazione. Scegli una persona dalla rubrica.',
    e2ee: 'Cifratura end-to-end', chooseChat: 'Scegli una conversazione', serverCiphertext: 'Sul server restano soltanto messaggi cifrati.', back: 'Torna alle conversazioni', verifyKeys: 'Verifica chiavi di sicurezza', message: 'Scrivi un messaggio', send: 'Invia',
    newConversation: 'NUOVA CONVERSAZIONE', findPerson: 'Trova una persona', contactPicker: 'Scegli quali contatti condividere. Nessun dato della rubrica viene conservato.', openContacts: 'Apri la rubrica', orEmail: 'Oppure cerca per email', search: 'Cerca', close: 'Chiudi',
    fingerprints: 'CIFRATURA END-TO-END', securityKeys: 'Chiavi di sicurezza', compareKeys: 'Confronta queste impronte con il contatto usando un canale diverso, idealmente di persona. Se coincidono, il server non ha sostituito le chiavi.', yourDevice: 'Il tuo dispositivo',
    loginFailed: 'Accesso non riuscito. Riprova.', googleUnavailable: 'Google Identity non disponibile. Ricarica la pagina e riprova.', deviceMissing: 'Questo account è già associato a un altro dispositivo. Senza la chiave privata originale i vecchi messaggi non possono essere decifrati.', cryptoFailed: 'Impossibile inizializzare la cifratura su questo dispositivo.', peerNeedsDevice: 'La persona deve aprire Angara sul proprio dispositivo prima di poter ricevere messaggi cifrati.', keyChanged: 'La chiave di sicurezza del contatto è cambiata. Invio bloccato: verifica l’impronta di persona.', messageFailed: 'Messaggio non inviato.', undecipherable: 'Messaggio non decifrabile', noUsers: 'Nessun utente registrato trovato per queste email.', pushFailed: 'Notifiche non abilitate. Su iPhone installa prima l’app nella schermata Home.', keyWarning: 'La chiave del contatto è cambiata: non inviare messaggi finché non l’hai verificata.',
  },
  en: {
    brand: 'Angara', loading: 'Loading…', loginEyebrow: 'TEXT ONLY. ONLY PEOPLE YOU CHOOSE.', loginTitle: 'A small chat, without the noise.', loginText: 'Sign in with Google to write to people you know. Your contacts are never stored.', install: 'Install app', installPhone: 'Install Angara on your phone',
    keyEyebrow: 'DEVICE KEY', keyTitle: 'Encryption is blocked.', keyText: 'Angara cannot recover the key from the server: that separation is what prevents the server from reading messages.', logout: 'Sign out',
    available: 'Available', newChat: 'New chat', notifications: 'Enable notifications', conversations: 'Conversations', encryptedMessage: 'Encrypted message', startWriting: 'Start writing…', empty: 'No conversations yet. Choose someone from your contacts.',
    e2ee: 'End-to-end encryption', chooseChat: 'Choose a conversation', serverCiphertext: 'Only encrypted messages remain on the server.', back: 'Back to conversations', verifyKeys: 'Verify security keys', message: 'Write a message', send: 'Send',
    newConversation: 'NEW CONVERSATION', findPerson: 'Find someone', contactPicker: 'Choose which contacts to share. No address-book data is retained.', openContacts: 'Open contacts', orEmail: 'Or search by email', search: 'Search', close: 'Close',
    fingerprints: 'END-TO-END ENCRYPTION', securityKeys: 'Security keys', compareKeys: 'Compare these fingerprints with your contact through another channel, ideally in person. If they match, the server has not replaced the keys.', yourDevice: 'Your device',
    loginFailed: 'Sign-in failed. Try again.', googleUnavailable: 'Google Identity is unavailable. Reload the page and try again.', deviceMissing: 'This account is already associated with another device. Without the original private key, previous messages cannot be decrypted.', cryptoFailed: 'Unable to initialize encryption on this device.', peerNeedsDevice: 'This person needs to open Angara on their device before receiving encrypted messages.', keyChanged: 'This contact’s security key has changed. Sending is blocked: verify the fingerprint first.', messageFailed: 'Message was not sent.', undecipherable: 'Message cannot be decrypted', noUsers: 'No registered users were found for these email addresses.', pushFailed: 'Notifications were not enabled. On iPhone, install the app to the Home Screen first.', keyWarning: 'This contact’s key has changed: do not send messages until you have verified it.',
  },
  ru: {
    brand: 'Ангара', loading: 'Загрузка…', loginEyebrow: 'ТОЛЬКО ТЕКСТ. ТОЛЬКО ВЫБРАННЫЕ ЛЮДИ.', loginTitle: 'Небольшой чат без лишнего шума.', loginText: 'Войдите через Google, чтобы общаться со знакомыми. Контакты не сохраняются.', install: 'Установить приложение', installPhone: 'Установить Ангару на телефон',
    keyEyebrow: 'КЛЮЧ УСТРОЙСТВА', keyTitle: 'Шифрование заблокировано.', keyText: 'Ангара не может восстановить ключ с сервера: именно это не позволяет серверу читать сообщения.', logout: 'Выйти',
    available: 'Доступен', newChat: 'Новый чат', notifications: 'Включить уведомления', conversations: 'Диалоги', encryptedMessage: 'Зашифрованное сообщение', startWriting: 'Начните писать…', empty: 'Пока нет диалогов. Выберите человека из контактов.',
    e2ee: 'Сквозное шифрование', chooseChat: 'Выберите диалог', serverCiphertext: 'На сервере остаются только зашифрованные сообщения.', back: 'К диалогам', verifyKeys: 'Проверить ключи безопасности', message: 'Напишите сообщение', send: 'Отправить',
    newConversation: 'НОВЫЙ ДИАЛОГ', findPerson: 'Найти человека', contactPicker: 'Выберите контакты для отправки. Данные адресной книги не сохраняются.', openContacts: 'Открыть контакты', orEmail: 'Или найдите по email', search: 'Найти', close: 'Закрыть',
    fingerprints: 'СКВОЗНОЕ ШИФРОВАНИЕ', securityKeys: 'Ключи безопасности', compareKeys: 'Сверьте эти отпечатки с собеседником через другой канал, лучше лично. Если они совпадают, сервер не подменил ключи.', yourDevice: 'Ваше устройство',
    loginFailed: 'Не удалось войти. Повторите попытку.', googleUnavailable: 'Сервис Google Identity недоступен. Обновите страницу и повторите попытку.', deviceMissing: 'Этот аккаунт уже привязан к другому устройству. Без исходного закрытого ключа прежние сообщения нельзя расшифровать.', cryptoFailed: 'Не удалось включить шифрование на этом устройстве.', peerNeedsDevice: 'Собеседнику нужно открыть Ангару на своём устройстве, прежде чем он сможет получать зашифрованные сообщения.', keyChanged: 'Ключ безопасности собеседника изменился. Отправка заблокирована: сначала проверьте отпечаток.', messageFailed: 'Сообщение не отправлено.', undecipherable: 'Не удалось расшифровать сообщение', noUsers: 'Для этих адресов email не найдено зарегистрированных пользователей.', pushFailed: 'Не удалось включить уведомления. На iPhone сначала установите приложение на экран «Домой».', keyWarning: 'Ключ собеседника изменился: не отправляйте сообщения, пока не проверите его.',
  },
} as const;

export type MessageKey = keyof typeof messages.it;

function browserLocale(): Locale {
  const language = navigator.language.toLowerCase().split('-')[0];
  return supportedLocales.includes(language as Locale) ? language as Locale : 'en';
}

export const locale = ref<Locale>(browserLocale());
export const t = (key: MessageKey) => computed(() => messages[locale.value][key]).value;
