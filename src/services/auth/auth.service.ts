import Keycloak from "keycloak-js";
import {ConfigService} from "../config";
import {Service} from "../baseService";
import {AxiosRequestConfig} from "axios";
import {LoggerService} from "../logger";

const KC_CONFIG_OPTIONS: string[] = ["url", "realm", "clientId"];
const KC_INIT_OPTIONS: string[] = [
    "useNonce", "adapter", "onLoad", "token", "refreshToken", "idToken", "timeSkew", "checkLoginIframe",
    "checkLoginIframeInterval", "responseMode", "redirectUri", "silentCheckSsoRedirectUri", "flow",
    "pkceMethod", "enableLogging"
];

function only(items: string[], allOptions: any): any {
    const rval: any = {};
    items.forEach(item => {
        if (allOptions[item] !== undefined) {
            rval[item] = allOptions[item];
        }
    });
    return rval;
}

export interface AuthenticatedUser {
    username: string;
    displayName: string;
    fullName: string;
    roles: string[];
}

/**
 * Initializes Keycloak instance and calls the provided callback function if successfully authenticated.
 *
 * @param onAuthenticatedCallback
 */

export class AuthService implements Service {

    // @ts-ignore
    protected logger: LoggerService = null;
    // @ts-ignore
    protected config: ConfigService = null;

    private enabled: boolean = false;
    // @ts-ignore
    private config: ConfigService = null;
    // @ts-ignore
    private logger: LoggerService = null;
    // @ts-ignore
    private keycloak: Keycloak.KeycloakInstance;
    // @ts-ignore
    private user: AuthenticatedUser;

    public init = () => {
        // no init?
    }

    public authenticateUsingKeycloak = (onAuthenticatedCallback: () => void) => {
        const configOptions: any = only(KC_CONFIG_OPTIONS, this.config.authOptions());
        const initOptions: any = only(KC_INIT_OPTIONS, this.config.authOptions());

        this.keycloak = Keycloak(configOptions);

        const addRoles: ((user: AuthenticatedUser) => void) = (user) => {
            if (this.keycloak.realmAccess && this.keycloak.realmAccess.roles) {
                user.roles = user.roles.concat(this.keycloak.realmAccess.roles);
            }

            if (this.keycloak.resourceAccess) {
                Object.keys(this.keycloak.resourceAccess)
                    // @ts-ignore
                    .forEach(key => (user.roles = user.roles.concat(this.keycloak.resourceAccess[key].roles)))
            }
        };

        const fakeUser: (() => AuthenticatedUser) = () => {
            return {
                displayName: "User",
                fullName: "User",
                roles: [],
                username: "User"
            };
        };

        const infoToUser: (() => AuthenticatedUser) = () => {
            const ui: any = this.keycloak.userInfo;
            return {
                displayName: ui.given_name,
                fullName: ui.name,
                roles: [],
                username: ui.preferred_username
            };
        };

        this.keycloak.init(initOptions)
            .then((authenticated) => {
                if (authenticated) {
                    this.logger.info("[AuthService] Keycloak authentication successful.");
                    this.keycloak.loadUserInfo().then(() => {
                        this.logger.info("[AuthService] Keycloak user loaded.");
                        this.user = infoToUser();
                        addRoles(this.user);
                        onAuthenticatedCallback();
                    }).catch(() => {
                        this.logger.warn("[AuthService] Using fake KC user.");
                        this.user = fakeUser();
                        addRoles(this.user);
                        onAuthenticatedCallback();
                    })
                } else {
                    this.logger.warn("[AuthService] Not authenticated!");
                    this.doLogin();
                }
            }).catch(error => {
                this.logger.error("[AuthService] Keycloak auth failed: %o", error);
            });
    };

    public isAuthenticated = () => this.keycloak.authenticated;

    public doLogin = () => this.keycloak.login;

    public doLogout = () =>  this.keycloak.logout;

    public getToken = () => this.keycloak.token;

    public isAuthEnabled(): boolean {
        return this.enabled;
    }

    public isUserAdmin(): boolean {
        if (!this.isAuthEnabled()) {
            return true;
        }
        let rval: boolean = false;
        this.user.roles.forEach(role => {
            if (role === "sr-admin") {
                rval = true;
            }
        });
        return rval;
    }

    public isUserDeveloper(): boolean {
        if (!this.isAuthEnabled()) {
            return true;
        }
        let rval: boolean = false;
        this.user.roles.forEach(role => {
            if (role === "sr-admin" || role === "sr-developer") {
                rval = true;
            }
        });
        return rval;
    }

    public authenticateAndRender(render: () => void): void {
        if (this.config.authType() === "keycloakjs") {
            this.logger.info("[AuthService] Keycloak authentication enabled.");
            this.enabled = true;
            this.authenticateUsingKeycloak(render);
        } else {
            this.logger.info("[AuthService] Authentication disabled.  Rendering.");
            this.enabled = false;
            render();
        }
    }

    public getAuthInterceptor(): (config: AxiosRequestConfig) => Promise<any> {
        const self: AuthService = this;
        const interceptor = (config: AxiosRequestConfig) => {
            if (self.config.authType() === "keycloakjs") {
                return self.updateKeycloakToken(() => {
                    config.headers.Authorization = `Bearer ${this.getToken()}`;
                    return Promise.resolve(config);
                });
            } else {
                return Promise.resolve(config);
            }
        };
        return interceptor;
    }

    public getTokenFunction = (): (() => Promise<string>) => {
        const self: AuthService = this;
        return () => {
            if (self.config.authType() === "keycloakjs") {
                return this.keycloak.updateToken(5).then(() => {
                    return Promise.resolve(self.getToken() as string);
                });
            } else {
                return Promise.resolve("");
            }
        };
    };

    // @ts-ignore
    private updateKeycloakToken = (successCallback) => {
        return this.keycloak.updateToken(5)
            .then(successCallback)
            .catch(this.doLogin)
    };
}
