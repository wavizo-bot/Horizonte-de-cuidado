# Regra A2: stack traces desofuscáveis.
-keepattributes SourceFile,LineNumberTable,RuntimeVisibleAnnotations,AnnotationDefault
-renamesourcefileattribute SourceFile

# A ponte WebView chama HostBridge.call por reflexão do addJavascriptInterface.
# Sem manter o método anotado, o R8 pode removê-lo/renomeá-lo e a nuvem,
# exportação, importação e impressão param de funcionar no release.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# AndroidX WebKit usa classes do Chromium em tempo de execução; não são
# referências ausentes no APK, mas o R8 pode avisar em builds futuros.
-dontwarn org.chromium.**
