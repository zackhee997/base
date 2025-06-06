// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/client-vpn-endpoint.ts

import {
  ec2ClientVpnEndpoint,
  ec2ClientVpnNetworkAssociation,
} from "@cdktf/provider-aws";
import { Token } from "cdktf";
import { Construct, DependencyGroup, IDependable } from "constructs";
import {
  ClientVpnAuthorizationRule,
  ClientVpnAuthorizationRuleOptions,
} from "./client-vpn-authorization-rule";
import {
  IClientVpnConnectionHandler,
  IClientVpnEndpoint,
  ClientVpnOutputs,
  TransportProtocol,
  VpnPort,
} from "./client-vpn-endpoint-types";
import { ClientVpnRoute, ClientVpnRouteOptions } from "./client-vpn-route";
import { Connections } from "./connections";
import { CidrBlock } from "./network-util";
import { ISecurityGroup, SecurityGroup } from "./security-group";
import { ISamlProvider } from "../iam";
import { IVpc, SubnetSelection } from "./vpc";
import { AwsConstructBase, AwsConstructProps } from "../aws-construct";
import * as logs from "../cloudwatch";

/**
 * Options for a client VPN endpoint
 */
export interface ClientVpnEndpointOptions {
  /**
   * The IPv4 address range, in CIDR notation, from which to assign client IP
   * addresses. The address range cannot overlap with the local CIDR of the VPC
   * in which the associated subnet is located, or the routes that you add manually.
   *
   * Changing the address range will replace the Client VPN endpoint.
   *
   * The CIDR block should be /22 or greater.
   */
  readonly cidr: string;

  /**
   * The ARN of the client certificate for mutual authentication.
   *
   * The certificate must be signed by a certificate authority (CA) and it must
   * be provisioned in AWS Certificate Manager (ACM).
   *
   * @default - use user-based authentication
   */
  readonly clientCertificateArn?: string;

  /**
   * The type of user-based authentication to use.
   *
   * @see https://docs.aws.amazon.com/vpn/latest/clientvpn-admin/client-authentication.html
   *
   * @default - use mutual authentication
   */
  readonly userBasedAuthentication?: ClientVpnUserBasedAuthentication;

  /**
   * Whether to enable connections logging
   *
   * @default true
   */
  readonly logging?: boolean;

  /**
   * A CloudWatch Logs log group for connection logging
   *
   * @default - a new group is created
   */
  readonly logGroup?: logs.ILogGroup;

  /**
   * A CloudWatch Logs log stream for connection logging
   *
   * @default - a new stream is created
   */
  readonly logStream?: logs.ILogStream;

  /**
   * The AWS Lambda function used for connection authorization
   *
   * The name of the Lambda function must begin with the `AWSClientVPN-` prefix
   *
   * @default - no connection handler
   */
  readonly clientConnectionHandler?: IClientVpnConnectionHandler;

  /**
   * A brief description of the Client VPN endpoint.
   *
   * @default - no description
   */
  readonly description?: string;

  /**
   * The security groups to apply to the target network.
   *
   * @default - a new security group is created
   */
  readonly securityGroups?: ISecurityGroup[];

  /**
   * Specify whether to enable the self-service portal for the Client VPN endpoint.
   *
   * @default true
   */
  readonly selfServicePortal?: boolean;

  /**
   * The ARN of the server certificate
   */
  readonly serverCertificateArn: string;

  /**
   * Indicates whether split-tunnel is enabled on the AWS Client VPN endpoint.
   *
   * @see https://docs.aws.amazon.com/vpn/latest/clientvpn-admin/split-tunnel-vpn.html
   *
   * @default false
   */
  readonly splitTunnel?: boolean;

  /**
   * The transport protocol to be used by the VPN session.
   *
   * @default TransportProtocol.UDP
   */
  readonly transportProtocol?: TransportProtocol;

  /**
   * The port number to assign to the Client VPN endpoint for TCP and UDP
   * traffic.
   *
   * @default VpnPort.HTTPS
   */
  readonly port?: VpnPort;

  /**
   * Information about the DNS servers to be used for DNS resolution.
   *
   * A Client VPN endpoint can have up to two DNS servers.
   *
   * @default - use the DNS address configured on the device
   */
  readonly dnsServers?: string[];

  /**
   * Subnets to associate to the client VPN endpoint.
   *
   * @default - the VPC default strategy
   */
  readonly vpcSubnets?: SubnetSelection;

  /**
   * Whether to authorize all users to the VPC CIDR
   *
   * This automatically creates an authorization rule. Set this to `false` and
   * use `addAuthorizationRule()` to create your own rules instead.
   *
   * @default true
   */
  readonly authorizeAllUsersToVpcCidr?: boolean;

  /**
   * The maximum VPN session duration time.
   *
   * @default ClientVpnSessionTimeout.TWENTY_FOUR_HOURS
   */
  readonly sessionTimeout?: ClientVpnSessionTimeout;

  /**
   * Customizable text that will be displayed in a banner on AWS provided clients
   * when a VPN session is established.
   *
   * UTF-8 encoded characters only. Maximum of 1400 characters.
   *
   * @default - no banner is presented to the client
   */
  readonly clientLoginBanner?: string;
  /**
   * Whether to register Terraform outputs for this TerraConstruct
   *
   * @default false
   */
  readonly registerOutputs?: boolean;

  /**
   * Optional override for the outputs name
   *
   * @default id
   */
  readonly outputName?: string;
}

/**
 * Maximum VPN session duration time
 */
export enum ClientVpnSessionTimeout {
  /** 8 hours */
  EIGHT_HOURS = 8,
  /** 10 hours */
  TEN_HOURS = 10,
  /** 12 hours */
  TWELVE_HOURS = 12,
  /** 24 hours */
  TWENTY_FOUR_HOURS = 24,
}

/**
 * User-based authentication for a client VPN endpoint
 */
export abstract class ClientVpnUserBasedAuthentication {
  /**
   * Active Directory authentication
   */
  public static activeDirectory(
    directoryId: string,
  ): ClientVpnUserBasedAuthentication {
    return new ActiveDirectoryAuthentication(directoryId);
  }

  /** Federated authentication */
  public static federated(
    samlProvider: ISamlProvider,
    selfServiceSamlProvider?: ISamlProvider,
  ): ClientVpnUserBasedAuthentication {
    return new FederatedAuthentication(samlProvider, selfServiceSamlProvider);
  }

  /** Renders the user based authentication */
  public abstract render(): any;
}

/**
 * Active Directory authentication
 */
class ActiveDirectoryAuthentication extends ClientVpnUserBasedAuthentication {
  constructor(private readonly directoryId: string) {
    super();
  }

  render(): any {
    return {
      type: "directory-service-authentication",
      activeDirectoryId: this.directoryId,
    };
  }
}

/**
 * Federated authentication
 */
class FederatedAuthentication extends ClientVpnUserBasedAuthentication {
  constructor(
    private readonly samlProvider: ISamlProvider,
    private readonly selfServiceSamlProvider?: ISamlProvider,
  ) {
    super();
  }

  render(): any {
    return {
      type: "federated-authentication",
      samlProviderArn: this.samlProvider.samlProviderArn,
      selfServiceSamlProviderArn: this.selfServiceSamlProvider?.samlProviderArn,
    };
  }
}

/**
 * Properties for a client VPN endpoint
 */
export interface ClientVpnEndpointProps
  extends ClientVpnEndpointOptions,
    AwsConstructProps {
  /**
   * The VPC to connect to.
   */
  readonly vpc: IVpc;
}

/**
 * Attributes when importing an existing client VPN endpoint
 */
export interface ClientVpnEndpointAttributes {
  /**
   * The endpoint ID
   */
  readonly endpointId: string;

  /**
   * The security groups associated with the endpoint
   */
  readonly securityGroups: ISecurityGroup[];
}

/**
 * A client VPN connnection
 */
export class ClientVpnEndpoint
  extends AwsConstructBase
  implements IClientVpnEndpoint
{
  /**
   * Import an existing client VPN endpoint
   */
  public static fromEndpointAttributes(
    scope: Construct,
    id: string,
    attrs: ClientVpnEndpointAttributes,
  ): IClientVpnEndpoint {
    class Import extends AwsConstructBase implements IClientVpnEndpoint {
      public readonly endpointId = attrs.endpointId;
      public get clientVpnOutputs(): ClientVpnOutputs {
        return {
          clientVpnEndpointId: this.endpointId,
        };
      }
      public get outputs(): Record<string, any> {
        return this.clientVpnOutputs;
      }
      public readonly connections = new Connections({
        securityGroups: attrs.securityGroups,
      });
      public readonly targetNetworksAssociated: IDependable =
        new DependencyGroup();
    }
    return new Import(scope, id);
  }

  public readonly endpointId: string;
  public readonly selfServicePortalUrl?: string;

  /**
   * Allows specify security group connections for the endpoint.
   */
  public readonly connections: Connections;

  public readonly targetNetworksAssociated: IDependable;

  private readonly _targetNetworksAssociated = new DependencyGroup();

  public get clientVpnOutputs(): ClientVpnOutputs {
    return {
      clientVpnEndpointId: this.endpointId,
      selfServicePortalUrl: this.selfServicePortalUrl,
    };
  }
  public get outputs(): Record<string, any> {
    return this.clientVpnOutputs;
  }
  public resource: ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint;

  constructor(scope: Construct, id: string, props: ClientVpnEndpointProps) {
    super(scope, id, props);

    if (!Token.isUnresolved(props.vpc.vpcCidrBlock)) {
      const clientCidr = new CidrBlock(props.cidr);
      const vpcCidr = new CidrBlock(props.vpc.vpcCidrBlock);
      if (vpcCidr.containsCidr(clientCidr)) {
        throw new Error(
          "The client CIDR cannot overlap with the local CIDR of the VPC",
        );
      }
    }

    if (props.dnsServers && props.dnsServers.length > 2) {
      throw new Error("A client VPN endpoint can have up to two DNS servers");
    }

    if (props.logging == false && (props.logGroup || props.logStream)) {
      throw new Error(
        "Cannot specify `logGroup` or `logStream` when logging is disabled",
      );
    }

    if (
      props.clientConnectionHandler &&
      !Token.isUnresolved(props.clientConnectionHandler.functionName) &&
      !props.clientConnectionHandler.functionName.startsWith("AWSClientVPN-")
    ) {
      throw new Error(
        "The name of the Lambda function must begin with the `AWSClientVPN-` prefix",
      );
    }

    if (
      props.clientLoginBanner &&
      !Token.isUnresolved(props.clientLoginBanner) &&
      props.clientLoginBanner.length > 1400
    ) {
      throw new Error(
        `The maximum length for the client login banner is 1400, got ${props.clientLoginBanner.length}`,
      );
    }

    const logging = props.logging ?? true;
    const logGroup = logging
      ? (props.logGroup ?? new logs.LogGroup(this, "LogGroup"))
      : undefined;

    const securityGroups = props.securityGroups ?? [
      new SecurityGroup(this, "SecurityGroup", {
        vpc: props.vpc,
      }),
    ];
    this.connections = new Connections({ securityGroups });

    this.resource = new ec2ClientVpnEndpoint.Ec2ClientVpnEndpoint(
      this,
      "Resource",
      {
        authenticationOptions: renderAuthenticationOptions(
          props.clientCertificateArn,
          props.userBasedAuthentication,
        ),
        clientCidrBlock: props.cidr,
        clientConnectOptions: props.clientConnectionHandler
          ? {
              enabled: true,
              lambdaFunctionArn: props.clientConnectionHandler.functionArn,
            }
          : undefined,
        connectionLogOptions: {
          enabled: logging,
          cloudwatchLogGroup: logGroup?.logGroupName,
          cloudwatchLogStream: props.logStream?.logStreamName,
        },
        description: props.description,
        dnsServers: props.dnsServers,
        securityGroupIds: securityGroups.map((s) => s.securityGroupId),
        selfServicePortal: booleanToEnabledDisabled(props.selfServicePortal),
        serverCertificateArn: props.serverCertificateArn,
        splitTunnel: props.splitTunnel,
        transportProtocol: props.transportProtocol,
        vpcId: props.vpc.vpcId,
        vpnPort: props.port,
        sessionTimeoutHours: props.sessionTimeout,
        clientLoginBannerOptions: props.clientLoginBanner
          ? {
              enabled: true,
              bannerText: props.clientLoginBanner,
            }
          : undefined,
      },
    );

    this.endpointId = this.resource.id;

    if (props.userBasedAuthentication && (props.selfServicePortal ?? true)) {
      // Output self-service portal URL
      this.selfServicePortalUrl = this.resource.selfServicePortalUrl;
      // new TerraformOutput(this, "SelfServicePortalUrl", {
      //   value: `https://self-service.clientvpn.amazonaws.com/endpoints/${this.endpointId}`,
      // });
    }

    // Associate subnets
    const subnetIds = props.vpc.selectSubnets(props.vpcSubnets).subnetIds;

    if (Token.isUnresolved(subnetIds)) {
      throw new Error(
        "Cannot associate subnets when VPC are imported from parameters or exports containing lists of subnet IDs.",
      );
    }

    for (const [idx, subnetId] of Object.entries(subnetIds)) {
      this._targetNetworksAssociated.add(
        new ec2ClientVpnNetworkAssociation.Ec2ClientVpnNetworkAssociation(
          this,
          `Association${idx}`,
          {
            clientVpnEndpointId: this.endpointId,
            subnetId,
          },
        ),
      );
    }
    this.targetNetworksAssociated = this._targetNetworksAssociated;

    if (props.authorizeAllUsersToVpcCidr ?? true) {
      this.addAuthorizationRule("AuthorizeAll", {
        cidr: props.vpc.vpcCidrBlock,
      });
    }
  }

  /**
   * Adds an authorization rule to this endpoint
   */
  public addAuthorizationRule(
    id: string,
    props: ClientVpnAuthorizationRuleOptions,
  ): ClientVpnAuthorizationRule {
    return new ClientVpnAuthorizationRule(this, id, {
      ...props,
      clientVpnEndpoint: this,
    });
  }

  /**
   * Adds a route to this endpoint
   */
  public addRoute(id: string, props: ClientVpnRouteOptions): ClientVpnRoute {
    return new ClientVpnRoute(this, id, {
      ...props,
      clientVpnEndpoint: this,
    });
  }
}

function renderAuthenticationOptions(
  clientCertificateArn?: string,
  userBasedAuthentication?: ClientVpnUserBasedAuthentication,
): ec2ClientVpnEndpoint.Ec2ClientVpnEndpointAuthenticationOptions[] {
  const authenticationOptions: ec2ClientVpnEndpoint.Ec2ClientVpnEndpointAuthenticationOptions[] =
    [];

  if (clientCertificateArn) {
    authenticationOptions.push({
      type: "certificate-authentication",
      rootCertificateChainArn: clientCertificateArn,
    });
  }

  if (userBasedAuthentication) {
    authenticationOptions.push(userBasedAuthentication.render());
  }

  if (authenticationOptions.length === 0) {
    throw new Error(
      "A client VPN endpoint must use at least one authentication option",
    );
  }
  return authenticationOptions;
}

function booleanToEnabledDisabled(
  val?: boolean,
): "enabled" | "disabled" | undefined {
  switch (val) {
    case undefined:
      return undefined;
    case true:
      return "enabled";
    case false:
      return "disabled";
  }
}
