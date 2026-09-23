// Spanish UI strings. Every user-facing string for Julio lives here.

export const es = {
  app: {
    title: "Entrenador de Speaking IELTS",
    underConstruction: "La aplicación está en construcción. Muy pronto podrás practicar aquí.",
  },

  browser: {
    unsupported:
      "Esta aplicación necesita Microsoft Edge o Google Chrome para reconocer tu voz. Ábrela en Edge (recomendado: tiene las voces más naturales) o en Chrome.",
  },

  micCheck: {
    title: "Prueba del micrófono",
    noticeTitle: "Antes de empezar",
    notice:
      "Mientras el micrófono está encendido, el navegador envía tu voz a Google (en Chrome) o a Microsoft (en Edge) para convertirla en texto. Nosotros no guardamos tu audio. Para mejores resultados, usa audífonos y busca un lugar tranquilo.",
    noticeOk: "Entendido",
    intro: "Vamos a grabar 3 segundos. Di una frase en inglés, por ejemplo: “My name is Julio and I am a nurse.”",
    record: "Grabar 3 segundos",
    recording: "Grabando… habla ahora",
    playing: "Reproduciendo tu grabación…",
    heard: "Esto es lo que entendimos:",
    heardNothing: "No entendimos nada. Revisa que el micrófono esté conectado y vuelve a intentarlo.",
    noPlayback: "No pudimos reproducir la grabación, pero el reconocimiento de voz funciona.",
    retry: "Repetir la prueba",
    level: "Nivel del micrófono",
    headphonesQuestion: "¿Usas audífonos?",
    headphonesYes: "Sí, uso audífonos",
    headphonesNo: "No, uso las bocinas de la computadora",
    headphonesAdvice:
      "Te recomendamos mucho usar audífonos: así el examinador no se escucha en tu micrófono y puedes interrumpirlo si hace falta.",
    examinerTest: "Ahora vas a escuchar al examinador.",
    done: "¡Listo! El micrófono y la voz funcionan.",
  },

  recognition: {
    network:
      "El reconocimiento de voz no responde en este navegador. Puedes seguir usando el botón “Mantén presionado para hablar”, o abrir la aplicación en {other}.",
    notAllowed:
      "El navegador bloqueó el micrófono. Haz clic en el candado junto a la dirección de la página, permite el micrófono y vuelve a cargar la página.",
    audioCapture: "No encontramos un micrófono. Conecta uno (o tus audífonos con micrófono) y vuelve a cargar la página.",
    language: "Este navegador no puede reconocer inglés. Abre la aplicación en {other}.",
    start:
      "El reconocimiento de voz no pudo iniciar. Puedes seguir usando el botón “Mantén presionado para hablar”, o abrir la aplicación en {other}.",
    unsupported:
      "Este navegador no tiene reconocimiento de voz. Abre la aplicación en Microsoft Edge o en Google Chrome.",
    pushToTalk: "Mantén presionado para hablar",
    pushToTalkActive: "Escuchando… suelta cuando termines",
    otherBrowserEdge: "Microsoft Edge",
    otherBrowserChrome: "Google Chrome",
  },

  vad: {
    unavailable:
      "No pudimos medir el volumen del micrófono. El examen funciona igual, pero sin el medidor de nivel.",
  },
} as const;

export type Strings = typeof es;
