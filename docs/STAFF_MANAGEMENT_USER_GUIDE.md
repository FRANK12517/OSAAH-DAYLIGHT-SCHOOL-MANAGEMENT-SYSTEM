# Staff Management User Guide

## Register staff

1. Open **Staff Management** as an authenticated user with the `staff.manage` permission.
2. Enter the staff member’s full name, canonical Staff ID, phone, normalized email, username, and primary role.
3. Select class and subject assignments from the existing school configuration when applicable.
4. Click **Generate Password** or enter a password with at least 12 characters containing uppercase, lowercase, a number, and a symbol.
5. Click **Register Staff**. The temporary password is shown only in the success response; do not store it in the directory or application logs.

Registration creates the durable user, staff, profile, role mapping, school association, and assignment records in one transaction. A failed step rolls the registration back.

## Directory and search

Use the **Search staff** field to filter by name, Staff ID, username, email, or role. The directory displays the canonical `staff.staff_number`, never a password or password hash.

## Reset a password

Select **Reset Password** for an active staff member and confirm the action. The old password is invalidated and active sessions are revoked. Share the newly generated password securely; it is not retained in the directory.

## Remove or deactivate staff

Select **Remove**, review the confirmation, and confirm. The account is deactivated rather than hard-deleted so attendance, academic, audit, and other historical references remain intact. The account cannot authenticate after deactivation. The currently signed-in administrator cannot deactivate or remove their own managing account.

## Login identifiers

Staff may sign in with either their username or normalized email address. Both resolve to the same durable account.
