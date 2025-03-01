import express from "express";
import { generateCredentials } from "./services/generateCredentialResponse";
import { toDataURL } from "qrcode";
import { generateProofJWT } from "./services/jwtHelper";
import { holderDummyECKeys } from "./services/generateDummyKeyPair";
import { CredentialOffer } from "./services/interfaces";
import { verifyProofJWT } from "./middleware/verifyProofJWT";
import { generateMetadata } from "./services/generateMetadata";
import { OpenidPresentationsService } from "./services/OpenidPresentationsService";
import { presentationDefinition } from "./data/presentationDefinition";

/*
    Implementation of the Authorization Code Flow, the Issuer-initi-
    ated variation, described in Appendix G.1.
    URL: https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html#use-case-1
*/

const vciPrefix = "api/vci";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

/*
    The holder (or their client) generates a proof JWT that demonst-
    rates control of their private key. This is usually obtained via
    a POST request to a dedicated endpoint (or generated within a w-
    allet app) and then sent in the Authorization header of subsequ-
    ent requests.
*/
app.post(`/${vciPrefix}/generateHolderProof`, async (req, res) => {
    /*
        The specification proposes two steps instead of a single one for
        this functionality, namely that the user should first use a user
        and password pair to get an authorization code, and then use the
        authorization code to get the holder proof token.
        This is described in section 3.4 of the VCI specification.
    */
    try {
        const { iss } = req.body; // Expecting the client to provide the holder identifier (iss)

        if (!iss)
            return res
                .status(400)
                .json({ error: "Holder identifier (iss) is required" });

        const payload = {
            nonce: Math.random().toString(36).substring(2, 15),
            aud: `http://localhost:${port}/generateCredential`,
            iss,
            iat: Math.floor(Date.now() / 1000),
        };

        const { token, decoded } = generateProofJWT(
            payload,
            holderDummyECKeys.publicKey,
            holderDummyECKeys.privateKey
        );

        res.json({ token, decoded });
    } catch (error: any) {
        console.error("Error generating holder proof JWT:", error);
        res.status(500).json({
            error: error.message || "Failed to generate holder proof JWT",
        });
    }
});

/*
    In production, the proof JWT of the holder is provided by the c-
    The issuer publishes or serves a credential offer—often present-
    ed as a QR code or a URL. The offer provides key details like t-
    he URL for requesting the credential, as well as the instructio-
    ns for the holder on how to proceed.
    In a real-world scenario, the offer might include additional me-
    tadata or security parameters.
    Use ../qr-viewer.html to view the generated QR code.
*/
app.get(`/${vciPrefix}/getCredentialOffer`, async (_, res) => {
    try {
        // Example offer details
        const offer: CredentialOffer = {
            issuer: `http://localhost:${port}`,
            credentialType: "Diploma",
            /*
                The URL where the holder can initiate the credential issuance p-
                rocess. This might include a unique offer identifier in a produ-
                ction setup.
            */
            offerUrl: `http://localhost:${port}/${vciPrefix}/generateCredential`,
        };

        /*
            Generate a QR code from the offer URL.
        */
        const qrCodeDataUrl = await toDataURL(offer.offerUrl);

        /*
            Return the offer and the QR code as a JSON response, after which
            the client can render the QR code image from the data URL.
        */
        res.json({
            offer,
            qrCode: qrCodeDataUrl,
        });
    } catch (error) {
        console.error("Error generating credential offer:", error);
        res.status(500).json({ error: "Failed to generate credential offer" });
    }
});

app.post(`/${vciPrefix}/generateMetadata`, async (req, res) => {
    try {
        const credentials = req.body.credentials;

        const result = generateMetadata(credentials);
        res.send(result);
    } catch (error: any) {
        res.status(500).json({
            error: error.message || "Failed to generate credential",
        });
    }
});

/*
    In production, the proof JWT of the holder is provided by the c-
    lient in the Authorization header. The middleware extracts it a-
    nd verifies it, then attaches the decoded payload to req.proof.
    For example:
        Authorization: Bearer <holder-proof-jwt>
*/
app.post(
    `/${vciPrefix}/generateCredential`,
    verifyProofJWT,
    async (req, res) => {
        try {
            /*
            Typically, the issuer would have the credential data already (f-
            or example, from a trusted database) or it would generate it ba-
            sed on some pre-verified information. The holder might not supp-
            ly all of this data in the request. The request might simply in-
            clude a reference (like an identifier) to retrieve the appropri-
            ate data on the issuer’s side.
        */
            const credentials = req.body.credentials;

            /*
            The disclosure frame is used for selective disclosure, thus all-
            owing the holder to control what information exactly is revealed
            during presentation. In a production scenario, the disclosure f-
            rame might be standardized or negotiated between issuer and hol-
            der, rather than being provided arbitrarily in the request.
        */
            const disclosureFrame = req.body.disclosureFrame;

            const result = await generateCredentials(
                credentials,
                disclosureFrame
            );
            res.send(result);
        } catch (error: any) {
            res.status(500).json({
                error: error.message || "Failed to generate credential",
            });
        }
    }
);

const vpPrefix = "api/vp";

app.get(`/${vpPrefix}/getPresentationRequest`, async (_, res) => {
    try {
        const { state, signedRequestObject } =
            await openidService.generateSignedRequestObject(
                presentationDefinition
            );
        res.send({ state, signedRequestObject });
    } catch (err) {
        res.status(500).send({
            error: err instanceof Error ? err.message : "Unknown error",
        });
    }
});

const openidService = new OpenidPresentationsService();

/*
    The wallet itself decides on which credentials to pass to the v-
    erifier based on the presentation request. Right now I am passi-
    ng the entire credential token.
*/
app.post(`/${vpPrefix}/presentCredentials`, async (req, res) => {
    try {
        await openidService.verifyPresentationToken(req, res);
    } catch (error) {
        console.error("Error presenting credentials:", error);
        return res.status(500).json({ error: (error as Error).message });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
