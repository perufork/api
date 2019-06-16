import { User, ApiKey } from "../interfaces/tables/user";
import { Organization } from "../interfaces/tables/organization";
import {
  ErrorCode,
  Authorizations,
  UserRole,
  MembershipRole
} from "../interfaces/enum";
import { getUser, getApiKey } from "../crud/user";
import { getUserMemberships, getMembership } from "../crud/membership";
import { getOrganization } from "../crud/organization";
import { Membership } from "../interfaces/tables/memberships";

/**
 * Whether a user can perform an action on another user
 */
const canUserUser = async (
  user: User,
  action: Authorizations,
  target: User
) => {
  // A super user can do anything
  if (user.role == UserRole.ADMIN) return true;

  // A user can do anything to herself
  if (user.id == target.id) return true;

  const userMemberships = await getUserMemberships(user);
  const targetMemberships = await getUserMemberships(target);

  const similarMemberships: number[] = [];
  userMemberships.forEach((userMembership, index) => {
    targetMemberships.forEach(targetMembership => {
      if (userMembership.id && userMembership.id == targetMembership.id)
        similarMemberships.push(index);
    });
  });

  let allowed = false;
  similarMemberships.forEach(similarMembership => {
    // A reseller can view/edit/delete users in her organization
    if (
      user.role == UserRole.RESELLER &&
      (action == Authorizations.READ ||
        action == Authorizations.UPDATE ||
        action == Authorizations.DELETE)
    )
      allowed = true;

    if (action == Authorizations.READ) {
      // A user can read another user in the same organization, as long as they're not a basic member
      if (userMemberships[similarMembership].role != MembershipRole.BASIC)
        allowed = true;
    }
  });

  return allowed;
};

/**
 * Whether a user can perform an action on an organization
 */
const canUserOrganization = async (
  user: User,
  action: Authorizations,
  target: Organization
) => {
  // A super user can do anything
  if (user.role == UserRole.ADMIN) return true;

  const memberships = await getUserMemberships(user);
  const targetMemberships = memberships.filter(
    m => m.organizationId == target.id
  );

  let allowed = false;
  targetMemberships.forEach(membership => {
    // An organization owner can do anything
    if (membership.role == MembershipRole.OWNER) allowed = true;

    // An organization admin can do anything too
    if (membership.role == MembershipRole.ADMIN) allowed = true;

    // An organization manager can do anything but delete
    if (
      membership.role == MembershipRole.MANAGER &&
      action != Authorizations.DELETE
    )
      allowed = true;

    // An organization member can read, not edit/delete/invite
    if (
      membership.role == MembershipRole.MEMBER &&
      action == Authorizations.READ
    )
      allowed = true;
  });

  return allowed;
};

/**
 * Whether a user can perform an action on a membership
 */
const canUserMembership = async (
  user: User,
  action: Authorizations,
  target: Membership
) => {
  // A super user can do anything
  if (user.role == UserRole.ADMIN) return true;

  // A member can do anything to herself
  if (user.id == target.userId) return true;

  const memberships = await getUserMemberships(user);

  let allowed = false;
  memberships.forEach(membership => {
    // An admin, owner, or manager can edit
    if (
      membership.organizationId == target.organizationId &&
      (membership.role == MembershipRole.OWNER ||
        membership.role == MembershipRole.ADMIN ||
        membership.role == MembershipRole.MANAGER)
    )
      allowed = true;

    // Another member can view
    if (
      membership.organizationId == target.organizationId &&
      membership.role == MembershipRole.MEMBER &&
      action == Authorizations.READ
    )
      allowed = true;
  });

  return allowed;
};

/**
 * Whether a user can perform an action for the backend
 */
const canUserGeneral = async (user: User, action: Authorizations) => {
  // A super user can do anything
  if (user.role == UserRole.ADMIN) return true;

  return false;
};

const canUserApiKey = async (
  user: User,
  action: Authorizations,
  target: ApiKey
) => {
  // A user can do anything to her API key
  if (target.userId == user.id) return true;

  let secureAction = action;
  if (action === Authorizations.CREATE)
    secureAction = Authorizations.CREATE_SECURE;
  if (action === Authorizations.READ) secureAction = Authorizations.READ_SECURE;
  if (action === Authorizations.UPDATE)
    secureAction = Authorizations.UPDATE_SECURE;
  if (action === Authorizations.DELETE)
    secureAction = Authorizations.DELETE_SECURE;

  const owner = await getUser(target.userId);
  return await canUserUser(user, secureAction, owner);
};

/**
 * Whether a user has authorization to perform an action
 * @param ipAddress  IP address for the new location
 */
export const can = async (
  user: User | number,
  action: Authorizations,
  targetType: "user" | "organization" | "membership" | "api-key" | "general",
  target?: User | Organization | Membership | ApiKey | number
) => {
  let userObject: User;
  if (typeof target === "object") {
    userObject = target as User;
  } else {
    userObject = await getUser(user as number);
  }
  if (!userObject.id) throw new Error(ErrorCode.USER_NOT_FOUND);

  let targetObject: User | Organization | Membership | ApiKey;
  if (targetType === "user") {
    if (typeof target === "string" || typeof target === "number")
      targetObject = await getUser(target);
    else targetObject = target as User;
    return await canUserUser(userObject, action, targetObject as User);
  } else if (targetType === "organization") {
    if (typeof target === "string" || typeof target === "number")
      targetObject = await getOrganization(target);
    else targetObject = target as Organization;
    return await canUserOrganization(
      userObject,
      action,
      targetObject as Organization
    );
  } else if (targetType === "membership") {
    if (typeof target === "string" || typeof target === "number")
      targetObject = await getMembership(target);
    else targetObject = target as Membership;
    return await canUserMembership(
      userObject,
      action,
      targetObject as Membership
    );
  } else if (targetType === "api-key") {
    if (typeof target === "string" || typeof target === "number")
      targetObject = await getApiKey(target.toString());
    else targetObject = target as ApiKey;
    return await canUserApiKey(userObject, action, targetObject as ApiKey);
  }

  return await canUserGeneral(userObject, action);
};
