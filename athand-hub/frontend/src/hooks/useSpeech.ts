import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Web Speech API 语音输入 hook。
 */
export function useSpeech() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'zh-CN'  // 默认中文，也支持英文混合
    recognition.maxAlternatives = 1

    recognition.onresult = (e: any) => {
      const result = Array.from(e.results as SpeechRecognitionResultList)
        .map((r: any) => r[0].transcript)
        .join('')
      setTranscript(result)
    }

    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
  }, [])

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      setTranscript('')
      recognitionRef.current.start()
      setIsListening(true)
    }
  }, [isListening])

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    }
  }, [isListening])

  const supported = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  return { isListening, transcript, startListening, stopListening, supported }
}
