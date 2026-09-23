// Examiner lines for the lab only. The real exam scripts arrive in step 2
// (/src/exams) and the question bank in step 4.

export const opening = (name: string) =>
  `Good afternoon. My name is ${name || "your examiner"}. This is the speech lab. I'm going to ask you a few short questions.`;

export const QUESTIONS = [
  "Let's talk about your work. What do you do?",
  "What do you like most about your job?",
  "Is there anything you would like to change about your work?",
  "Now let's talk about shoes. Do you prefer comfortable shoes or fashionable ones?",
  "How often do you buy new shoes?",
  "Have you ever bought shoes online?",
];

export const CLOSING = "Thank you. That is the end of the lab conversation.";

/** Long enough to talk over (barge-in) or to check that it stays out of the transcript (speakers). */
export const LONG_LINE =
  "In this part of the test, I'm going to give you a topic and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish. Do you understand? Here is some paper and a pencil for making notes, and here is your topic.";

export const MONOLOGUE_START = "Please start speaking now.";
export const MONOLOGUE_STOP = "Thank you.";

/** About 25 seconds of speech for the ducking test. */
export const DUCKING_PASSAGE =
  "This is the volume test. Listen to how loud my voice is right now. In a few seconds the microphone stream will open. Keep listening and notice whether my voice becomes quieter. A few seconds after that, speech recognition will start as well. Again, notice whether the volume changes. If my voice stays at the same level the whole time, everything is working as it should. This is the end of the volume test.";
