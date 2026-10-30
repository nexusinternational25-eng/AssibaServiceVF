import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/**
 * Signe l'APK aligné produit par la CI, sur le poste qui détient la clé.
 * Usage : java -cp apksig-2.3.0.jar:. SignApk <entrée.apk> <sortie.apk> <keystore.jks> <fichier-mot-de-passe>
 * La bibliothèque apksig-2.3.0.jar se trouve sur Maven Central (com.android.tools.build:apksig).
 */
public class SignApk {
    public static void main(String[] args) throws Exception {
        File in = new File(args[0]);
        File out = new File(args[1]);
        char[] pass = new String(Files.readAllBytes(new File(args[3]).toPath()), StandardCharsets.UTF_8).trim().toCharArray();

        KeyStore ks = KeyStore.getInstance("JKS".equalsIgnoreCase(guessType(args[2])) ? "JKS" : "PKCS12");
        try (FileInputStream f = new FileInputStream(args[2])) { ks.load(f, pass); }
        String alias = "assibaservice";
        PrivateKey key = (PrivateKey) ks.getKey(alias, pass);
        X509Certificate cert = (X509Certificate) ks.getCertificate(alias);

        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("ASSIBA", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(signer))
                .setInputApk(in)
                .setOutputApk(out)
                .setV1SigningEnabled(false) // Android 7+ (minSdk 24) : la signature v2 suffit
                .setV2SigningEnabled(true)
                .setCreatedBy("AssibaService")
                .build()
                .sign();

        ApkVerifier.Result r = new ApkVerifier.Builder(out).build().verify();
        System.out.println("Vérifié : " + r.isVerified() + " (v1 " + r.isVerifiedUsingV1Scheme() + ", v2 " + r.isVerifiedUsingV2Scheme() + ")");
        r.getErrors().forEach(e -> System.out.println("Erreur : " + e));
        r.getWarnings().forEach(w -> System.out.println("Avertissement : " + w));
        if (!r.isVerified()) System.exit(1);
    }

    // Les keystores créés par keytool récent sont au format PKCS12 même avec l'extension .jks
    private static String guessType(String path) throws Exception {
        byte[] head = new byte[4];
        try (FileInputStream f = new FileInputStream(path)) { f.read(head); }
        return (head[0] == (byte) 0xFE && head[1] == (byte) 0xED) ? "JKS" : "PKCS12";
    }
}
