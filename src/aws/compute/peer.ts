// https://github.com/aws/aws-cdk/blob/v2.175.1/packages/aws-cdk-lib/aws-ec2/lib/peer.ts

import { Token } from "cdktf";
import { Connections, IConnectable } from "./connections";

/**
 * Interface for classes that provide the peer-specification parts of a security group rule
 */
export interface IPeer extends IConnectable {
  /**
   * Whether the rule can be inlined into a SecurityGroup or not
   */
  readonly canInlineRule: boolean;

  /**
   * A unique identifier for this connection peer
   */
  readonly uniqueId: string;

  /**
   * Produce the ingress rule JSON for the given connection
   */
  toIngressRuleConfig(): any;

  /**
   * Produce the egress rule JSON for the given connection
   */
  toEgressRuleConfig(): any;
}

/**
 * Peer object factories (to be used in Security Group management)
 *
 * The static methods on this object can be used to create peer objects
 * which represent a connection partner in Security Group rules.
 *
 * Use this object if you need to represent connection partners using plain IP
 * addresses, or a prefix list ID.
 *
 * If you want to address a connection partner by Security Group, you can just
 * use the Security Group (or the construct that contains a Security Group)
 * directly, as it already implements `IPeer`.
 */
export class Peer {
  /**
   * Create an IPv4 peer from a CIDR
   */
  public static ipv4(cidrIp: string): IPeer {
    return new CidrIPv4(cidrIp);
  }

  /**
   * Any IPv4 address
   */
  public static anyIpv4(): IPeer {
    return new AnyIPv4();
  }

  /**
   * Create an IPv6 peer from a CIDR
   */
  public static ipv6(cidrIp: string): IPeer {
    return new CidrIPv6(cidrIp);
  }

  /**
   * Any IPv6 address
   */
  public static anyIpv6(): IPeer {
    return new AnyIPv6();
  }

  /**
   * A prefix list
   */
  public static prefixList(prefixListId: string): IPeer {
    return new PrefixList(prefixListId);
  }

  /**
   * A security group ID
   *
   * NOTE: Terraform provider AWS does not support sourceSecurityGroupOwnerId
   */
  public static securityGroupId(
    securityGroupId: string,
    sourceSecurityGroupOwnerId?: string,
  ): IPeer {
    return new SecurityGroupId(securityGroupId, sourceSecurityGroupOwnerId);
  }

  protected constructor() {}
}

/**
 * A connection to and from a given IP range
 */
class CidrIPv4 implements IPeer {
  public readonly canInlineRule = true;
  public readonly connections: Connections = new Connections({ peer: this });
  public readonly uniqueId: string;

  constructor(private readonly cidrIp: string) {
    if (!Token.isUnresolved(cidrIp)) {
      const cidrMatch = cidrIp.match(/^(\d{1,3}\.){3}\d{1,3}(\/\d+)?$/);

      if (!cidrMatch) {
        throw new Error(`Invalid IPv4 CIDR: "${cidrIp}"`);
      }

      if (!cidrMatch[2]) {
        throw new Error(
          `CIDR mask is missing in IPv4: "${cidrIp}". Did you mean "${cidrIp}/32"?`,
        );
      }
    }

    this.uniqueId = cidrIp;
  }

  /**
   * Produce the ingress rule JSON for the given connection
   */
  public toIngressRuleConfig(): any {
    return {
      cidrIpv4: this.cidrIp,
      cidrBlocks: [this.cidrIp],
    };
  }
  /**
   * Produce the egress rule JSON for the given connection
   */
  public toEgressRuleConfig(): any {
    return {
      cidrIpv4: this.cidrIp,
      cidrBlocks: [this.cidrIp],
    };
  }
}

/**
 * Any IPv4 address
 */
class AnyIPv4 extends CidrIPv4 {
  constructor() {
    super("0.0.0.0/0");
  }
}

/**
 * A connection to a from a given IPv6 range
 */
class CidrIPv6 implements IPeer {
  public readonly canInlineRule = true;
  public readonly connections: Connections = new Connections({ peer: this });
  public readonly uniqueId: string;

  constructor(private readonly cidrIpv6: string) {
    if (!Token.isUnresolved(cidrIpv6)) {
      const cidrMatch = cidrIpv6.match(
        /^([\da-f]{0,4}:){2,7}([\da-f]{0,4})?(\/\d+)?$/,
      );

      if (!cidrMatch) {
        throw new Error(`Invalid IPv6 CIDR: "${cidrIpv6}"`);
      }

      if (!cidrMatch[3]) {
        throw new Error(
          `CIDR mask is missing in IPv6: "${cidrIpv6}". Did you mean "${cidrIpv6}/128"?`,
        );
      }
    }

    this.uniqueId = cidrIpv6;
  }

  /**
   * Produce the ingress rule JSON for the given connection
   */
  public toIngressRuleConfig(): any {
    return {
      cidrIpv6: this.cidrIpv6,
      ipv6CidrBlocks: [this.cidrIpv6],
    };
  }
  /**
   * Produce the egress rule JSON for the given connection
   */
  public toEgressRuleConfig(): any {
    return {
      cidrIpv6: this.cidrIpv6,
      ipv6CidrBlocks: [this.cidrIpv6],
    };
  }
}

/**
 * Any IPv6 address
 */
class AnyIPv6 extends CidrIPv6 {
  constructor() {
    super("::/0");
  }
}

/**
 * A prefix list
 *
 * Prefix lists are used to allow traffic to VPC-local service endpoints.
 *
 * For more information, see this page:
 *
 * https://docs.aws.amazon.com/AmazonVPC/latest/UserGuide/vpc-endpoints.html
 */
class PrefixList implements IPeer {
  public readonly canInlineRule = false;
  public readonly connections: Connections = new Connections({ peer: this });
  public readonly uniqueId: string;

  constructor(private readonly prefixListId: string) {
    this.uniqueId = prefixListId;
  }

  public toIngressRuleConfig(): any {
    return {
      prefixListId: this.prefixListId,
      prefixListIds: [this.prefixListId],
    };
  }

  public toEgressRuleConfig(): any {
    return {
      prefixListId: this.prefixListId,
      prefixListIds: [this.prefixListId],
    };
  }
}

/**
 * A connection to or from a given security group ID
 *
 * For ingress rules, a sourceSecurityGroupOwnerId parameter can be specified if
 * the security group exists in another account.
 * This parameter will be ignored for egress rules.
 */
class SecurityGroupId implements IPeer {
  public readonly canInlineRule = true;
  public readonly connections: Connections = new Connections({ peer: this });
  public readonly uniqueId: string;

  // private readonly sourceSecurityGroupOwnerId?: string;

  constructor(
    private readonly securityGroupId: string,
    sourceSecurityGroupOwnerId?: string,
  ) {
    // this.sourceSecurityGroupOwnerId = _sourceSecurityGroupOwnerId;
    if (!Token.isUnresolved(securityGroupId)) {
      const securityGroupMatch = securityGroupId.match(/^sg-[a-z0-9]{8,17}$/);

      if (!securityGroupMatch) {
        throw new Error(`Invalid security group ID: "${securityGroupId}"`);
      }
    }

    if (
      sourceSecurityGroupOwnerId &&
      !Token.isUnresolved(sourceSecurityGroupOwnerId)
    ) {
      const accountNumberMatch =
        sourceSecurityGroupOwnerId.match(/^[0-9]{12}$/);

      if (!accountNumberMatch) {
        throw new Error(
          `Invalid security group owner ID: "${sourceSecurityGroupOwnerId}"`,
        );
      }
    }
    this.uniqueId = securityGroupId;
  }

  /**
   * Produce the ingress rule JSON for the given connection
   */
  public toIngressRuleConfig(): any {
    return {
      securityGroups: [this.securityGroupId],
      // TODO: Terraform provider aws does not support sourceSecurityGroupOwnerId
      // ...(this.sourceSecurityGroupOwnerId && {
      //   sourceSecurityGroupOwnerId: this.sourceSecurityGroupOwnerId,
      // }),
    };
  }

  /**
   * Produce the egress rule JSON for the given connection
   */
  public toEgressRuleConfig(): any {
    return { securityGroups: [this.securityGroupId] };
  }
}
